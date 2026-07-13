import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';

import { createFarmdServer } from '../src/farmd.mjs';

async function withServer(service, run, options = {}) {
  const server = createFarmdServer({ service, ...options });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  try { await run(`http://127.0.0.1:${address.port}`); } finally { await new Promise((resolve) => server.close(resolve)); }
}

test('farmd serves management state and the universal model gateway', async () => {
  const calls = [];
  const service = {
    listSilos: async () => [{ id: 'agensis/workspace-1/agent-1', lifecycle: 'running' }],
    listModels: async () => ({ object: 'list', data: [{ id: 'crew', object: 'model' }] }),
    complete: async (request) => {
      calls.push(request);
      return new Response(JSON.stringify({ model: request.model, choices: [{ message: { content: 'done' } }] }), { headers: { 'content-type': 'application/json' } });
    },
  };
  await withServer(service, async (baseUrl) => {
    const health = await (await fetch(`${baseUrl}/health`)).json();
    assert.equal(health.service, 'farmd');
    assert.equal(health.source.license, 'AGPL-3.0-or-later');
    assert.match(health.source.url, /^https:\/\/github\.com\//);
    assert.equal((await (await fetch(`${baseUrl}/v1/farm/silos`)).json()).data[0].id, 'agensis/workspace-1/agent-1');
    assert.equal((await (await fetch(`${baseUrl}/v1/models`)).json()).data[0].id, 'crew');
    const completion = await fetch(`${baseUrl}/v1/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: 'crew', messages: [] }) });
    assert.equal((await completion.json()).choices[0].message.content, 'done');
    assert.equal(calls[0].model, 'crew');
  });
});

test('farmd forwards streaming response bodies without buffering', async () => {
  const service = {
    listSilos: async () => [],
    listModels: async () => ({ object: 'list', data: [] }),
    complete: async () => new Response('data: {"choices":[{"delta":{"content":"live"}}]}\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } }),
  };
  await withServer(service, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/v1/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: 'crew', stream: true, messages: [] }) });
    assert.match(response.headers.get('content-type'), /text\/event-stream/);
    assert.match(await response.text(), /data: \[DONE\]/);
  });
});

test('farmd exposes exact coding-job cancellation', async () => {
  const calls = [];
  const service = {
    listSilos: async () => [],
    listModels: async () => ({ object: 'list', data: [] }),
    cancelJob: async (jobId, workspaceId) => { calls.push({ jobId, workspaceId }); return { id: jobId, status: 'cancelled' }; },
  };
  await withServer(service, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/v1/farm/jobs/job-1/cancel?workspaceId=workspace-1`, { method: 'POST' });
    assert.equal((await response.json()).data.status, 'cancelled');
    assert.deepEqual(calls, [{ jobId: 'job-1', workspaceId: 'workspace-1' }]);
  });
});

test('farmd keeps Responses and Anthropic Messages compatibility on the same listener', async () => {
  const requests = [];
  const service = {
    listSilos: async () => [],
    listModels: async () => ({ object: 'list', data: [] }),
    complete: async (request) => {
      requests.push(request);
      return new Response(JSON.stringify({
        id: 'chatcmpl-1', model: request.model,
        choices: [{ message: { role: 'assistant', content: 'universal', tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'lookup', arguments: '{"q":"farm"}' } }] }, finish_reason: 'tool_calls' }],
        usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
      }), { headers: { 'content-type': 'application/json' } });
    },
  };
  await withServer(service, async (baseUrl) => {
    const responses = await fetch(`${baseUrl}/v1/responses`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: 'crew', input: 'hello', tools: [{ type: 'function', name: 'lookup', parameters: { type: 'object' } }] }) });
    const responsePayload = await responses.json();
    assert.equal(responsePayload.output_text, 'universal');
    assert.equal(responsePayload.output[1].type, 'function_call');

    const messages = await fetch(`${baseUrl}/v1/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: 'crew', system: 'help', messages: [{ role: 'user', content: 'hello' }] }) });
    const messagePayload = await messages.json();
    assert.equal(messagePayload.content[0].text, 'universal');
    assert.equal(messagePayload.content[1].type, 'tool_use');
    assert.deepEqual(requests.map((request) => request.model), ['crew', 'crew']);
    assert.deepEqual(requests[0].messages, [{ role: 'user', content: 'hello' }]);
    assert.deepEqual(requests[1].messages, [{ role: 'system', content: 'help' }, { role: 'user', content: 'hello' }]);
  });
});

test('compatibility streams preserve incremental text, tools, and prior tool turns', async () => {
  const requests = [];
  const streamBody = [
    'data: {"choices":[{"delta":{"content":"live "}}]}',
    '',
    'data: {"choices":[{"delta":{"content":"now","tool_calls":[{"index":0,"id":"call-new","type":"function","function":{"name":"lookup","arguments":"{\\"q\\":"}}]}}]}',
    '',
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"farm\\"}"}}]},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":4,"completion_tokens":3,"total_tokens":7}}',
    '',
    'data: [DONE]',
    '',
  ].join('\n');
  const service = {
    listSilos: async () => [],
    listModels: async () => ({ object: 'list', data: [] }),
    complete: async (request) => {
      requests.push(request);
      return new Response(streamBody, { headers: { 'content-type': 'text/event-stream' } });
    },
  };

  await withServer(service, async (baseUrl) => {
    const responses = await fetch(`${baseUrl}/v1/responses`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'crew', stream: true,
        input: [
          { type: 'function_call', call_id: 'call-old', name: 'lookup', arguments: '{"q":"old"}' },
          { type: 'function_call_output', call_id: 'call-old', output: 'old result' },
        ],
      }),
    });
    const responseEvents = await responses.text();
    assert.equal((responseEvents.match(/event: response\.output_text\.delta/g) || []).length, 2);
    assert.equal((responseEvents.match(/event: response\.function_call_arguments\.delta/g) || []).length, 2);
    assert.match(responseEvents, /event: response\.completed/);

    const messages = await fetch(`${baseUrl}/v1/messages`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'crew', stream: true,
        messages: [
          { role: 'assistant', content: [{ type: 'tool_use', id: 'call-old', name: 'lookup', input: { q: 'old' } }] },
          { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call-old', content: 'old result' }] },
        ],
      }),
    });
    const messageEvents = await messages.text();
    assert.equal((messageEvents.match(/"type":"text_delta"/g) || []).length, 2);
    assert.equal((messageEvents.match(/"type":"input_json_delta"/g) || []).length, 2);
    assert.match(messageEvents, /event: message_stop/);
  });

  assert.equal(requests.every((request) => request.stream === true), true);
  assert.deepEqual(requests[0].messages, [
    { role: 'assistant', content: null, tool_calls: [{ id: 'call-old', type: 'function', function: { name: 'lookup', arguments: '{"q":"old"}' } }] },
    { role: 'tool', tool_call_id: 'call-old', content: 'old result' },
  ]);
  assert.deepEqual(requests[1].messages, [
    { role: 'assistant', content: null, tool_calls: [{ id: 'call-old', type: 'function', function: { name: 'lookup', arguments: '{"q":"old"}' } }] },
    { role: 'tool', tool_call_id: 'call-old', content: 'old result' },
  ]);
});

test('farmd rejects untrusted browser origins when no API key is configured', async () => {
  const service = { listSilos: async () => [], listModels: async () => ({ object: 'list', data: [] }) };
  await withServer(service, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/v1/farm/silos`, { headers: { origin: 'https://attacker.example' } });
    assert.equal(response.status, 403);
  });
});

test('farmd requires an API key before binding beyond loopback', () => {
  const service = { listSilos: async () => [], listModels: async () => ({ object: 'list', data: [] }) };
  assert.throws(() => createFarmdServer({ service, host: '0.0.0.0' }), /API key/);
  assert.doesNotThrow(() => createFarmdServer({ service, host: '0.0.0.0', apiKey: 'secret' }).close());
});
