import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';

function sendJson(res, status, value) {
  const body = `${JSON.stringify(value)}\n`;
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) });
  res.end(body);
}

async function readJson(req, limit = 2 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error('Request body is too large'), { status: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw Object.assign(new Error('Request body must be valid JSON'), { status: 400 }); }
}

function authenticated(req, apiKey) {
  if (!apiKey) return true;
  const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  return bearer === apiKey || req.headers['x-api-key'] === apiKey;
}

function isLoopbackHost(host) {
  const value = String(host || '').trim().replace(/^\[|\]$/g, '').toLowerCase();
  return value === 'localhost' || value === '::1' || /^127(?:\.\d{1,3}){3}$/.test(value);
}

function trustedBrowserOrigin(origin, apiKey) {
  if (!origin || apiKey) return true;
  try { return isLoopbackHost(new URL(origin).hostname); } catch { return false; }
}

function forwardResponse(upstream, res) {
  const headers = {};
  for (const name of ['content-type', 'cache-control']) {
    const value = upstream.headers.get(name);
    if (value) headers[name] = value;
  }
  res.writeHead(upstream.status, headers);
  if (!upstream.body) return res.end();
  const stream = Readable.fromWeb(upstream.body);
  res.on('close', () => {
    try { stream.destroy(); } catch {}
  });
  stream.pipe(res);
}

function contentText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return content == null ? '' : JSON.stringify(content);
  return content.map((part) => {
    if (typeof part === 'string') return part;
    if (['text', 'input_text', 'output_text'].includes(part?.type)) return part.text || '';
    if (part?.type === 'tool_result') return contentText(part.content);
    return '';
  }).join('');
}

function openAIContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return contentText(content);
  return content.map((part) => {
    if (typeof part === 'string') return { type: 'text', text: part };
    if (['text', 'input_text', 'output_text'].includes(part?.type)) return { type: 'text', text: part.text || '' };
    if (part?.type === 'input_image' || part?.type === 'image_url') {
      return { type: 'image_url', image_url: typeof part.image_url === 'string' ? { url: part.image_url } : part.image_url };
    }
    if (part?.type === 'image' && part.source?.type === 'base64') {
      return { type: 'image_url', image_url: { url: `data:${part.source.media_type};base64,${part.source.data}` } };
    }
    return { type: 'text', text: contentText([part]) || JSON.stringify(part) };
  });
}

function compatibilityMessages(path, body) {
  const messages = [];
  const system = body.system ?? body.instructions;
  if (system) messages.push({ role: 'system', content: openAIContent(system) });
  const source = path === '/v1/responses'
    ? (typeof body.input === 'string' ? [{ role: 'user', content: body.input }] : body.input ?? [])
    : body.messages ?? [];
  for (const item of Array.isArray(source) ? source : []) {
    if (item?.type === 'function_call_output') {
      messages.push({ role: 'tool', tool_call_id: item.call_id, content: contentText(item.output) });
      continue;
    }
    if (item?.type === 'function_call') {
      messages.push({
        role: 'assistant',
        content: null,
        tool_calls: [{
          id: item.call_id || item.id,
          type: 'function',
          function: { name: item.name || '', arguments: item.arguments || '{}' },
        }],
      });
      continue;
    }
    const message = item?.type === 'message' ? item : item;
    if (!message?.role) continue;
    if (path === '/v1/messages' && Array.isArray(message.content)) {
      const toolUses = message.content.filter((part) => part?.type === 'tool_use');
      const toolResults = message.content.filter((part) => part?.type === 'tool_result');
      const visible = message.content.filter((part) => !['tool_use', 'tool_result'].includes(part?.type));
      if (message.role === 'assistant') {
        messages.push({
          role: 'assistant',
          content: visible.length ? openAIContent(visible) : null,
          ...(toolUses.length ? {
            tool_calls: toolUses.map((part) => ({
              id: part.id,
              type: 'function',
              function: { name: part.name || '', arguments: JSON.stringify(part.input ?? {}) },
            })),
          } : {}),
        });
        continue;
      }
      if (visible.length || toolResults.length === 0) {
        messages.push({ role: message.role === 'system' ? 'system' : 'user', content: openAIContent(visible) });
      }
      for (const result of toolResults) {
        messages.push({ role: 'tool', tool_call_id: result.tool_use_id, content: contentText(result.content) });
      }
      continue;
    }
    messages.push({
      role: ['assistant', 'system', 'tool'].includes(message.role) ? message.role : 'user',
      content: openAIContent(message.content),
      ...(message.tool_call_id ? { tool_call_id: message.tool_call_id } : {}),
    });
  }
  return messages;
}

function compatibilityToolChoice(choice) {
  if (typeof choice === 'string' || choice == null) return choice;
  if (choice.type === 'tool' || choice.type === 'function') {
    return { type: 'function', function: { name: choice.name || choice.function?.name || '' } };
  }
  if (choice.type === 'any') return 'required';
  if (['auto', 'none', 'required'].includes(choice.type)) return choice.type;
  return choice;
}

function compatibilityTools(tools) {
  if (!Array.isArray(tools)) return undefined;
  return tools.map((tool) => tool?.function ? tool : ({
    type: 'function',
    function: {
      name: tool?.name,
      description: tool?.description,
      parameters: tool?.parameters || tool?.input_schema || { type: 'object' },
    },
  }));
}

function chatRequestFromCompatibility(path, body) {
  return {
    model: body.model,
    messages: compatibilityMessages(path, body),
    ...(body.tools ? { tools: compatibilityTools(body.tools) } : {}),
    ...(body.tool_choice ? { tool_choice: compatibilityToolChoice(body.tool_choice) } : {}),
    ...(body.temperature != null ? { temperature: body.temperature } : {}),
    ...(body.max_tokens != null || body.max_output_tokens != null ? { max_tokens: body.max_tokens ?? body.max_output_tokens } : {}),
    stream: body.stream === true,
    ...(body.stream === true ? { stream_options: { include_usage: true } } : {}),
  };
}

function normalizedUsage(usage = {}) {
  const input = Number(usage.prompt_tokens ?? usage.input_tokens ?? 0);
  const output = Number(usage.completion_tokens ?? usage.output_tokens ?? 0);
  return { input_tokens: input, output_tokens: output, total_tokens: Number(usage.total_tokens ?? input + output) };
}

function messageResult(value) {
  const message = value?.choices?.[0]?.message ?? {};
  return {
    text: contentText(message.content),
    toolCalls: Array.isArray(message.tool_calls) ? message.tool_calls : [],
    finishReason: value?.choices?.[0]?.finish_reason || 'stop',
    usage: normalizedUsage(value?.usage),
  };
}

function parseToolArguments(value) {
  try { return JSON.parse(String(value || '{}')); } catch { return { raw: String(value || '') }; }
}

function responsesPayload(model, result) {
  const id = `resp_${randomUUID().replaceAll('-', '')}`;
  const output = [{
    id: `msg_${randomUUID().replaceAll('-', '')}`,
    type: 'message', status: 'completed', role: 'assistant',
    content: [{ type: 'output_text', text: result.text, annotations: [] }],
  }];
  for (const call of result.toolCalls) {
    output.push({
      id: `fc_${randomUUID().replaceAll('-', '')}`,
      type: 'function_call', status: 'completed', call_id: call.id,
      name: call.function?.name || '', arguments: call.function?.arguments || '{}',
    });
  }
  return { id, object: 'response', created_at: Math.floor(Date.now() / 1000), status: 'completed', model, output, output_text: result.text, usage: result.usage };
}

function anthropicPayload(model, result) {
  const content = [{ type: 'text', text: result.text }];
  for (const call of result.toolCalls) content.push({ type: 'tool_use', id: call.id, name: call.function?.name || '', input: parseToolArguments(call.function?.arguments) });
  return {
    id: `msg_${randomUUID().replaceAll('-', '')}`, type: 'message', role: 'assistant', model, content,
    stop_reason: result.toolCalls.length ? 'tool_use' : 'end_turn', stop_sequence: null,
    usage: { input_tokens: result.usage.input_tokens, output_tokens: result.usage.output_tokens },
  };
}

function streamCompatibility(path, res, payload) {
  res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', connection: 'keep-alive' });
  if (path === '/v1/responses') {
    const emit = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
    emit('response.created', { response: { ...payload, status: 'in_progress', output: [] } });
    const message = payload.output.find((item) => item.type === 'message');
    emit('response.output_item.added', { output_index: 0, item: { ...message, status: 'in_progress', content: [] } });
    emit('response.output_text.delta', { item_id: message.id, output_index: 0, content_index: 0, delta: payload.output_text });
    emit('response.completed', { response: payload });
    return res.end();
  }
  const emit = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  emit('message_start', { type: 'message_start', message: { ...payload, content: [], stop_reason: null, usage: { input_tokens: payload.usage.input_tokens, output_tokens: 0 } } });
  payload.content.forEach((block, index) => {
    emit('content_block_start', { type: 'content_block_start', index, content_block: block.type === 'text' ? { type: 'text', text: '' } : { ...block, input: {} } });
    if (block.type === 'text') emit('content_block_delta', { type: 'content_block_delta', index, delta: { type: 'text_delta', text: block.text } });
    else emit('content_block_delta', { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(block.input) } });
    emit('content_block_stop', { type: 'content_block_stop', index });
  });
  emit('message_delta', { type: 'message_delta', delta: { stop_reason: payload.stop_reason, stop_sequence: null }, usage: { output_tokens: payload.usage.output_tokens } });
  emit('message_stop', { type: 'message_stop' });
  return res.end();
}

async function* chatCompletionChunks(stream) {
  if (!stream) return;
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    buffer = buffer.replace(/\r\n/g, '\n');
    let boundary = buffer.indexOf('\n\n');
    while (boundary >= 0) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const data = block.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n');
      if (data === '[DONE]') return;
      if (data) {
        try { yield JSON.parse(data); } catch { /* ignore malformed upstream event */ }
      }
      boundary = buffer.indexOf('\n\n');
    }
    if (done) break;
  }
}

function responseUsage(usage = {}) {
  const normalized = normalizedUsage(usage);
  return { input_tokens: normalized.input_tokens, output_tokens: normalized.output_tokens, total_tokens: normalized.total_tokens };
}

async function streamResponsesFromChat(upstream, res, model) {
  const responseId = `resp_${randomUUID().replaceAll('-', '')}`;
  const emit = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  let nextOutputIndex = 0;
  let textState = null;
  const tools = new Map();
  let usage = responseUsage();
  let finishReason = 'stop';
  emit('response.created', { response: { id: responseId, object: 'response', created_at: Math.floor(Date.now() / 1000), status: 'in_progress', model, output: [] } });

  for await (const chunk of chatCompletionChunks(upstream.body)) {
    if (chunk.usage) usage = responseUsage(chunk.usage);
    const choice = chunk.choices?.[0];
    if (!choice) continue;
    if (choice.finish_reason) finishReason = choice.finish_reason;
    const delta = choice.delta ?? {};
    if (typeof delta.content === 'string' && delta.content) {
      if (!textState) {
        textState = { id: `msg_${randomUUID().replaceAll('-', '')}`, outputIndex: nextOutputIndex++, text: '' };
        emit('response.output_item.added', { output_index: textState.outputIndex, item: { id: textState.id, type: 'message', status: 'in_progress', role: 'assistant', content: [] } });
        emit('response.content_part.added', { item_id: textState.id, output_index: textState.outputIndex, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } });
      }
      textState.text += delta.content;
      emit('response.output_text.delta', { item_id: textState.id, output_index: textState.outputIndex, content_index: 0, delta: delta.content });
    }
    for (const call of delta.tool_calls ?? []) {
      const key = Number(call.index ?? 0);
      let state = tools.get(key);
      if (!state) {
        state = { id: `fc_${randomUUID().replaceAll('-', '')}`, callId: call.id || `call_${randomUUID().replaceAll('-', '')}`, name: call.function?.name || '', arguments: '', outputIndex: nextOutputIndex++ };
        tools.set(key, state);
        emit('response.output_item.added', { output_index: state.outputIndex, item: { id: state.id, type: 'function_call', status: 'in_progress', call_id: state.callId, name: state.name, arguments: '' } });
      } else {
        if (call.id) state.callId = call.id;
        if (call.function?.name) state.name += call.function.name;
      }
      if (call.function?.arguments) {
        state.arguments += call.function.arguments;
        emit('response.function_call_arguments.delta', { item_id: state.id, output_index: state.outputIndex, delta: call.function.arguments });
      }
    }
  }

  const output = [];
  if (textState) {
    const item = { id: textState.id, type: 'message', status: 'completed', role: 'assistant', content: [{ type: 'output_text', text: textState.text, annotations: [] }] };
    output[textState.outputIndex] = item;
    emit('response.output_text.done', { item_id: textState.id, output_index: textState.outputIndex, content_index: 0, text: textState.text });
    emit('response.output_item.done', { output_index: textState.outputIndex, item });
  }
  for (const state of tools.values()) {
    const item = { id: state.id, type: 'function_call', status: 'completed', call_id: state.callId, name: state.name, arguments: state.arguments || '{}' };
    output[state.outputIndex] = item;
    emit('response.function_call_arguments.done', { item_id: state.id, output_index: state.outputIndex, arguments: item.arguments });
    emit('response.output_item.done', { output_index: state.outputIndex, item });
  }
  const payload = { id: responseId, object: 'response', created_at: Math.floor(Date.now() / 1000), status: 'completed', model, output: output.filter(Boolean), output_text: textState?.text || '', usage, incomplete_details: finishReason === 'length' ? { reason: 'max_output_tokens' } : null };
  emit('response.completed', { response: payload });
  res.end();
}

function anthropicStopReason(reason) {
  if (reason === 'tool_calls') return 'tool_use';
  if (reason === 'length') return 'max_tokens';
  return 'end_turn';
}

async function streamAnthropicFromChat(upstream, res, model) {
  const messageId = `msg_${randomUUID().replaceAll('-', '')}`;
  const emit = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  let nextBlockIndex = 0;
  let textState = null;
  const tools = new Map();
  let usage = responseUsage();
  let finishReason = 'stop';
  emit('message_start', { type: 'message_start', message: { id: messageId, type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } } });

  for await (const chunk of chatCompletionChunks(upstream.body)) {
    if (chunk.usage) usage = responseUsage(chunk.usage);
    const choice = chunk.choices?.[0];
    if (!choice) continue;
    if (choice.finish_reason) finishReason = choice.finish_reason;
    const delta = choice.delta ?? {};
    if (typeof delta.content === 'string' && delta.content) {
      if (!textState) {
        textState = { index: nextBlockIndex++, text: '' };
        emit('content_block_start', { type: 'content_block_start', index: textState.index, content_block: { type: 'text', text: '' } });
      }
      textState.text += delta.content;
      emit('content_block_delta', { type: 'content_block_delta', index: textState.index, delta: { type: 'text_delta', text: delta.content } });
    }
    for (const call of delta.tool_calls ?? []) {
      const key = Number(call.index ?? 0);
      let state = tools.get(key);
      if (!state) {
        state = { index: nextBlockIndex++, id: call.id || `toolu_${randomUUID().replaceAll('-', '')}`, name: call.function?.name || '', arguments: '' };
        tools.set(key, state);
        emit('content_block_start', { type: 'content_block_start', index: state.index, content_block: { type: 'tool_use', id: state.id, name: state.name, input: {} } });
      } else {
        if (call.id) state.id = call.id;
        if (call.function?.name) state.name += call.function.name;
      }
      if (call.function?.arguments) {
        state.arguments += call.function.arguments;
        emit('content_block_delta', { type: 'content_block_delta', index: state.index, delta: { type: 'input_json_delta', partial_json: call.function.arguments } });
      }
    }
  }

  const states = [...(textState ? [textState] : []), ...tools.values()].sort((left, right) => left.index - right.index);
  for (const state of states) emit('content_block_stop', { type: 'content_block_stop', index: state.index });
  emit('message_delta', { type: 'message_delta', delta: { stop_reason: anthropicStopReason(finishReason), stop_sequence: null }, usage: { output_tokens: usage.output_tokens } });
  emit('message_stop', { type: 'message_stop' });
  res.end();
}

async function streamCompatibilityFromChat(path, upstream, res, model) {
  res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', connection: 'keep-alive' });
  if (path === '/v1/responses') return streamResponsesFromChat(upstream, res, model);
  return streamAnthropicFromChat(upstream, res, model);
}

async function serveCompatibility(service, path, body, res, signal) {
  const upstream = await service.complete(chatRequestFromCompatibility(path, body), { signal });
  if (!upstream.ok) return forwardResponse(upstream, res);
  if (body.stream === true && /text\/event-stream/i.test(upstream.headers.get('content-type') || '')) {
    return streamCompatibilityFromChat(path, upstream, res, body.model);
  }
  const value = await upstream.json();
  const result = messageResult(value);
  const payload = path === '/v1/responses' ? responsesPayload(body.model, result) : anthropicPayload(body.model, result);
  if (body.stream === true) return streamCompatibility(path, res, payload);
  return sendJson(res, 200, payload);
}

export function createFarmdServer({ service, apiKey = '', host = '127.0.0.1' } = {}) {
  if (!service) throw new TypeError('Farm service is required');
  if (!isLoopbackHost(host) && !apiKey) throw new Error('farmd requires an API key before binding beyond loopback');
  const subscribers = new Set();
  const emit = (type, data) => {
    const event = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const response of subscribers) response.write(event);
  };

  const server = createServer(async (req, res) => {
    const origin = String(req.headers.origin || '');
    if (!trustedBrowserOrigin(origin, apiKey)) return sendJson(res, 403, { error: { message: 'Browser origin is not allowed', type: 'forbidden' } });
    res.setHeader('access-control-allow-origin', apiKey ? '*' : (origin || 'http://127.0.0.1'));
    res.setHeader('access-control-allow-headers', 'authorization, content-type, x-api-key');
    res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    try {
      const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/health')) {
        return sendJson(res, 200, {
          status: 'ok',
          service: 'farmd',
          version: '0.1.0',
          source: { license: 'AGPL-3.0-or-later', url: SOURCE_URL },
        });
      }
      if (!authenticated(req, apiKey)) return sendJson(res, 401, { error: { message: 'Invalid API key', type: 'authentication_error' } });
      if (req.method === 'GET' && url.pathname === '/v1/farm/events') {
        res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', connection: 'keep-alive' });
        res.write('event: ready\ndata: {}\n\n');
        subscribers.add(res);
        req.once('close', () => subscribers.delete(res));
        return;
      }
      if (req.method === 'GET' && url.pathname === '/v1/farm/silos') return sendJson(res, 200, { data: await service.listSilos(), errors: service.lastDiscoveryErrors ?? [] });
      if (req.method === 'POST' && url.pathname === '/v1/farm/silos') {
        const silo = await service.createSilo(await readJson(req));
        emit('silo.changed', silo);
        return sendJson(res, 201, { data: silo });
      }
      const actionMatch = /^\/v1\/farm\/silos\/(.+?)\/(start|pause|delete)$/.exec(url.pathname);
      if (req.method === 'POST' && actionMatch) {
        const silo = await service.siloAction(decodeURIComponent(actionMatch[1]), actionMatch[2]);
        emit('silo.changed', silo);
        return sendJson(res, 200, { data: silo });
      }
      if (req.method === 'POST' && url.pathname === '/v1/farm/integrations/agensis/device/start') {
        return sendJson(res, 201, await service.startPairing(await readJson(req)));
      }
      if (req.method === 'POST' && url.pathname === '/v1/farm/integrations/agensis/device/token') {
        const integration = await service.exchangePairing(await readJson(req));
        emit('integration.changed', { workspaceId: integration.workspaceId, baseUrl: integration.baseUrl });
        return sendJson(res, 200, { data: { ...integration, token: undefined } });
      }
      if (req.method === 'POST' && url.pathname === '/v1/farm/jobs') return sendJson(res, 201, { data: await service.createJob(await readJson(req)) });
      const jobMatch = /^\/v1\/farm\/jobs\/([^/]+)$/.exec(url.pathname);
      if (req.method === 'GET' && jobMatch) return sendJson(res, 200, { data: await service.getJob(decodeURIComponent(jobMatch[1]), url.searchParams.get('workspaceId')) });
      const jobCancelMatch = /^\/v1\/farm\/jobs\/([^/]+)\/cancel$/.exec(url.pathname);
      if (req.method === 'POST' && jobCancelMatch) {
        const job = await service.cancelJob(decodeURIComponent(jobCancelMatch[1]), url.searchParams.get('workspaceId'));
        emit('job.changed', job);
        return sendJson(res, 200, { data: job });
      }
      if (req.method === 'GET' && url.pathname === '/v1/models') return sendJson(res, 200, await service.listModels());
      if (req.method === 'POST' && url.pathname === '/v1/chat/completions') {
        const controller = new AbortController();
        req.once('aborted', () => controller.abort());
        const upstream = await service.complete(await readJson(req), { signal: controller.signal });
        return forwardResponse(upstream, res);
      }
      if (req.method === 'POST' && ['/v1/responses', '/v1/messages'].includes(url.pathname)) {
        const controller = new AbortController();
        req.once('aborted', () => controller.abort());
        return serveCompatibility(service, url.pathname, await readJson(req), res, controller.signal);
      }
      return sendJson(res, 404, { error: { message: `No route for ${req.method} ${url.pathname}`, type: 'not_found' } });
    } catch (error) {
      if (!res.headersSent) sendJson(res, error?.status || 500, { error: { message: error?.message || String(error), type: error?.code || 'farmd_error' } });
      else res.end();
    }
  });
  return server;
}
const SOURCE_URL = 'https://github.com/sahilshingate01/Agent-Farm-Web-Desktop';
