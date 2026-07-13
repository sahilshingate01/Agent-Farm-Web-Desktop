import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

function trimBaseUrl(value) {
  const baseUrl = String(value || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(baseUrl)) throw new TypeError('Agensis baseUrl must use http or https');
  const url = new URL(baseUrl);
  if (url.hostname === 'agensis.io' || url.hostname === 'www.agensis.io') {
    return 'https://agensis-backend.fly.dev';
  }
  if (['localhost', '127.0.0.1', '0.0.0.0'].includes(url.hostname) && ['5173', '8888'].includes(url.port)) {
    return 'http://127.0.0.1:3142';
  }
  return baseUrl;
}

async function responsePayload(response) {
  const type = response.headers.get('content-type') || '';
  if (type.includes('application/json')) return response.json();
  return { error: { message: await response.text() } };
}

export class AgensisClient {
  constructor({ baseUrl, token = '', workspaceId = '', fetchImpl = globalThis.fetch } = {}) {
    if (typeof fetchImpl !== 'function') throw new TypeError('A fetch implementation is required');
    this.baseUrl = trimBaseUrl(baseUrl);
    this.token = token;
    this.workspaceId = workspaceId;
    this.fetch = fetchImpl;
  }

  async request(path, { method = 'GET', body, authenticated = true, signal, headers = {} } = {}) {
    const requestHeaders = { accept: 'application/json', ...headers };
    if (body !== undefined) requestHeaders['content-type'] = 'application/json';
    if (authenticated) {
      if (!this.token) throw new Error('This Agensis request requires a Farm integration token');
      requestHeaders.authorization = `Bearer ${this.token}`;
    }
    const response = await this.fetch(`${this.baseUrl}${path}`, {
      method,
      headers: requestHeaders,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
    const payload = await responsePayload(response);
    if (!response.ok) {
      const message = payload?.error?.message || payload?.message || `Agensis returned HTTP ${response.status}`;
      const error = Object.assign(new Error(message), { status: response.status, code: payload?.error?.code, payload });
      throw error;
    }
    return payload;
  }

  startPairing({ name = 'Agent Farm' } = {}) {
    return this.request('/backend/integrations/farm/device/start', { method: 'POST', body: { name }, authenticated: false });
  }

  exchangeDeviceCode(deviceCode) {
    return this.request('/backend/integrations/farm/device/token', { method: 'POST', body: { deviceCode }, authenticated: false });
  }

  async listSilos() {
    const payload = await this.request('/backend/integrations/farm/silos');
    return payload.data ?? [];
  }

  async listSharedModels(workspaceId = this.workspaceId) {
    if (!workspaceId) throw new Error('workspaceId is required to list shared models');
    const payload = await this.request(`/backend/inference/v1/models?workspaceId=${encodeURIComponent(workspaceId)}`);
    return payload.data ?? payload;
  }

  async openChatCompletion(request, { signal } = {}) {
    const body = { ...request, workspaceId: request.workspaceId || this.workspaceId };
    if (!body.workspaceId) throw new Error('workspaceId is required for shared inference');
    const response = await this.fetch(`${this.baseUrl}/backend/inference/v1/chat/completions`, {
      method: 'POST',
      headers: { accept: 'application/json, text/event-stream', 'content-type': 'application/json', authorization: `Bearer ${this.token}` },
      body: JSON.stringify(body),
      signal,
    });
    if (!response.ok) {
      const payload = await responsePayload(response);
      throw Object.assign(new Error(payload?.error?.message || `Agensis returned HTTP ${response.status}`), { status: response.status, payload });
    }
    return response;
  }

  async chatCompletion(request, options = {}) {
    const response = await this.openChatCompletion({ ...request, stream: false }, options);
    return responsePayload(response);
  }

  async enrollAgent(descriptor = {}) {
    const payload = await this.request('/backend/integrations/farm/agents', { method: 'POST', body: descriptor });
    return payload.data;
  }

  async revokeAgent(agentId) {
    const payload = await this.request(`/backend/integrations/farm/agents/${encodeURIComponent(agentId)}`, { method: 'DELETE' });
    return payload.data;
  }

  async createJob(job) {
    const payload = await this.request('/backend/integrations/farm/jobs', { method: 'POST', body: job });
    return payload.data;
  }

  async getJob(jobId) {
    const payload = await this.request(`/backend/integrations/farm/jobs/${encodeURIComponent(jobId)}`);
    return payload.data;
  }

  async cancelJob(jobId) {
    const payload = await this.request(`/backend/integrations/farm/jobs/${encodeURIComponent(jobId)}/cancel`, { method: 'POST' });
    return payload.data;
  }
}

export class AgensisIntegrationStore {
  constructor({ stateRoot }) {
    if (!stateRoot) throw new TypeError('stateRoot is required');
    this.directory = join(stateRoot, 'integrations', 'agensis');
  }

  path(workspaceId) {
    if (!workspaceId) throw new TypeError('workspaceId is required');
    return join(this.directory, `${encodeURIComponent(workspaceId)}.json`);
  }

  async save(integration) {
    if (!integration?.workspaceId || !integration?.token || !integration?.baseUrl) {
      throw new TypeError('baseUrl, workspaceId, and token are required');
    }
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const target = this.path(integration.workspaceId);
    const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
    const value = { ...integration, baseUrl: trimBaseUrl(integration.baseUrl) };
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, target);
    return value;
  }

  async load(workspaceId) {
    try {
      return JSON.parse(await readFile(this.path(workspaceId), 'utf8'));
    } catch (error) {
      if (error?.code === 'ENOENT') return null;
      throw error;
    }
  }

  async list() {
    let files;
    try {
      files = await readdir(this.directory);
    } catch (error) {
      if (error?.code === 'ENOENT') return [];
      throw error;
    }
    const integrations = await Promise.all(files.filter((file) => file.endsWith('.json')).map(async (file) => {
      try { return JSON.parse(await readFile(join(this.directory, file), 'utf8')); } catch { return null; }
    }));
    return integrations.filter(Boolean);
  }
}
