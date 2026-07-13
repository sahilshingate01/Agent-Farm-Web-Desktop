import { AgensisClient } from './agensis-client.mjs';
import { pickCrewRoute } from './crew-router.mjs';
import { normalizeAgensisSilos } from './silo-registry.mjs';

function capabilitiesForRequest(request) {
  const required = ['text'];
  if (Array.isArray(request.tools) && request.tools.length) required.push('tools');
  if (request.stream === true) required.push('streaming');
  const hasVision = (request.messages ?? []).some((message) => (
    Array.isArray(message?.content) && message.content.some((part) => ['image_url', 'input_image', 'image'].includes(part?.type))
  ));
  if (hasVision) required.push('vision');
  return required;
}

function routeFromModel(model) {
  const farm = model.farm ?? {};
  return {
    id: model.id,
    status: farm.status || 'online',
    lifecycle: farm.lifecycle || 'running',
    locality: farm.locality || (farm.source === 'local' ? 'local' : 'remote'),
    capabilities: Array.isArray(farm.capabilities) ? farm.capabilities : ['text'],
    active: Number(farm.activeInference || 0),
    maxConcurrency: Number(farm.maxConcurrency || 1),
    priority: Number(farm.priority || 0),
    latencyMs: farm.latencyMs,
  };
}

function normalizeModel(model, integration) {
  return {
    ...model,
    object: 'model',
    created: Number(model.created || 0),
    farm: {
      ...(model.farm ?? {}),
      source: 'agensis',
      workspaceId: model.farm?.workspaceId || integration.workspaceId,
      locality: model.farm?.locality || 'remote',
      lifecycle: model.farm?.status === 'paused' ? 'paused' : 'running',
    },
  };
}

export class FarmService {
  constructor({
    registry,
    integrationStore,
    clientFactory = (integration) => new AgensisClient(integration),
    runtimes = {},
    discoveryPolicy = {},
    localGatewayBaseUrl = 'http://127.0.0.1:4545',
    localGatewayApiKey = '',
    fetchImpl = globalThis.fetch,
    delayImpl = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    runtimeWakeTimeoutMs = 30_000,
  } = {}) {
    if (!registry || !integrationStore) throw new TypeError('registry and integrationStore are required');
    this.registry = registry;
    this.integrationStore = integrationStore;
    this.clientFactory = clientFactory;
    this.runtimes = runtimes;
    this.discoveryPolicy = {
      includeShared: true,
      includeCoding: true,
      includeAllDaemons: false,
      includeFarmManaged: true,
      ...discoveryPolicy,
    };
    this.localGatewayBaseUrl = String(localGatewayBaseUrl || '').replace(/\/+$/, '');
    this.localGatewayApiKey = localGatewayApiKey;
    this.fetch = fetchImpl;
    this.delay = delayImpl;
    this.runtimeWakeTimeoutMs = runtimeWakeTimeoutMs;
    this.lastDiscoveryErrors = [];
  }

  async integrations() {
    return this.integrationStore.list();
  }

  client(integration) {
    return this.clientFactory({ ...integration, workspaceId: integration.workspaceId });
  }

  async discoveredSilos() {
    const integrations = await this.integrations();
    const results = await Promise.allSettled(integrations.map(async (integration) => (
      normalizeAgensisSilos(await this.client(integration).listSilos(), this.discoveryPolicy)
    )));
    this.lastDiscoveryErrors = results.filter((result) => result.status === 'rejected').map((result) => result.reason?.message || String(result.reason));
    return results.flatMap((result) => result.status === 'fulfilled' ? result.value : []);
  }

  async listSilos() {
    const [persisted, discovered] = await Promise.all([this.registry.list(), this.discoveredSilos()]);
    const merged = new Map(persisted.map((descriptor) => [descriptor.id, descriptor]));
    const managedByAgent = new Map(persisted
      .filter((descriptor) => descriptor.agensis?.workspaceId && descriptor.agensis?.agentId)
      .map((descriptor) => [`${descriptor.agensis.workspaceId}:${descriptor.agensis.agentId}`, descriptor]));
    for (const descriptor of discovered) {
      const managed = managedByAgent.get(`${descriptor.workspaceId}:${descriptor.agentId}`);
      if (managed) {
        const terminal = managed.lifecycle === 'deleted';
        const reachable = descriptor.lifecycle === 'running';
        const managedCloud = ['e2b', 'daytona'].includes(managed.runtime);
        merged.set(managed.id, {
          ...managed,
          status: terminal ? 'offline' : reachable ? descriptor.status : managedCloud ? 'paused' : descriptor.status,
          lifecycle: terminal ? 'deleted' : reachable ? 'running' : managedCloud ? 'paused' : descriptor.lifecycle,
          connectionId: descriptor.connectionId,
          capabilities: { ...(managed.capabilities ?? {}), ...(descriptor.capabilities ?? {}) },
        });
      } else {
        merged.set(descriptor.id, { ...merged.get(descriptor.id), ...descriptor });
      }
    }
    const connectedManagedIds = new Set(discovered
      .filter((descriptor) => ['online', 'busy'].includes(descriptor.status))
      .map((descriptor) => `${descriptor.workspaceId}:${descriptor.agentId}`));
    for (const descriptor of persisted) {
      const managedCloud = descriptor.management === 'managed' && ['e2b', 'daytona'].includes(descriptor.runtime);
      const agentKey = `${descriptor.agensis?.workspaceId || ''}:${descriptor.agensis?.agentId || ''}`;
      if (managedCloud && descriptor.lifecycle !== 'deleted' && !connectedManagedIds.has(agentKey)) {
        merged.set(descriptor.id, { ...merged.get(descriptor.id), status: 'paused', lifecycle: 'paused', connectionId: undefined });
      }
    }
    return [...merged.values()].sort((left, right) => left.id.localeCompare(right.id));
  }

  async remoteModels() {
    const integrations = await this.integrations();
    const results = await Promise.allSettled(integrations.map(async (integration) => (
      (await this.client(integration).listSharedModels(integration.workspaceId)).map((model) => normalizeModel(model, integration))
    )));
    return results.flatMap((result) => result.status === 'fulfilled' ? result.value : []);
  }

  async localModels() {
    if (!this.localGatewayBaseUrl) return [];
    try {
      const headers = { accept: 'application/json' };
      if (this.localGatewayApiKey) headers.authorization = `Bearer ${this.localGatewayApiKey}`;
      const response = await this.fetch(`${this.localGatewayBaseUrl}/v1/models`, { headers });
      if (!response.ok) return [];
      const payload = await response.json();
      return (payload.data ?? []).filter((model) => model.id !== 'crew').map((model) => ({
        ...model,
        farm: { ...(model.farm ?? {}), source: 'local', locality: 'local', lifecycle: 'running', status: 'online' },
      }));
    } catch {
      return [];
    }
  }

  async listModels() {
    const [local, remote] = await Promise.all([this.localModels(), this.remoteModels()]);
    const models = new Map();
    for (const model of [...local, ...remote]) models.set(model.id, model);
    return {
      object: 'list',
      data: [
        { id: 'crew', object: 'model', created: 0, owned_by: 'usage-farm', farm: { source: 'virtual', capabilities: ['text', 'tools', 'vision'], description: 'Capability-aware routing across local, remote, and cloud silos' } },
        ...models.values(),
      ],
    };
  }

  async complete(request, { signal } = {}) {
    if (!request?.model || !Array.isArray(request.messages)) throw Object.assign(new Error('model and messages are required'), { status: 400 });
    const models = await this.listModels();
    let selected = request.model;
    if (selected === 'crew') {
      const model = pickCrewRoute(models.data.filter((item) => item.id !== 'crew').map(routeFromModel), { capabilities: capabilitiesForRequest(request) });
      if (!model) throw Object.assign(new Error('No crew route can satisfy this request'), { status: 503 });
      selected = model.id;
    }
    const route = models.data.find((model) => model.id === selected);
    if (!route) throw Object.assign(new Error(`Model route '${selected}' was not found`), { status: 404 });

    if (route.farm?.source === 'agensis') {
      const integrations = await this.integrations();
      const integration = integrations.find((item) => item.workspaceId === route.farm.workspaceId);
      if (!integration) throw Object.assign(new Error(`Agensis workspace '${route.farm.workspaceId}' is not paired`), { status: 503 });
      return this.client(integration).openChatCompletion({ ...request, model: selected, workspaceId: integration.workspaceId }, { signal });
    }
    if (!this.localGatewayBaseUrl) throw Object.assign(new Error(`Local model route '${selected}' is unavailable`), { status: 503 });
    const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
    if (this.localGatewayApiKey) headers.authorization = `Bearer ${this.localGatewayApiKey}`;
    return this.fetch(`${this.localGatewayBaseUrl}/v1/chat/completions`, { method: 'POST', headers, body: JSON.stringify({ ...request, model: selected }), signal });
  }

  async proxyCompatibility(path, body, { signal, headers: incoming = {} } = {}) {
    if (!this.localGatewayBaseUrl) throw Object.assign(new Error('The local compatibility gateway is not configured'), { status: 503 });
    const headers = { 'content-type': 'application/json', accept: String(incoming.accept || 'application/json, text/event-stream') };
    if (incoming['anthropic-version']) headers['anthropic-version'] = String(incoming['anthropic-version']);
    if (this.localGatewayApiKey) {
      headers.authorization = `Bearer ${this.localGatewayApiKey}`;
      headers['x-api-key'] = this.localGatewayApiKey;
    }
    return this.fetch(`${this.localGatewayBaseUrl}${path}`, { method: 'POST', headers, body: JSON.stringify(body), signal });
  }

  async createSilo(input) {
    const runtime = this.runtimes[input?.runtime];
    if (!runtime?.create) throw Object.assign(new Error(`Runtime '${input?.runtime || ''}' is not configured`), { status: 400 });
    return runtime.create(input);
  }

  async siloAction(id, action) {
    const descriptor = await this.registry.get(id);
    const runtime = descriptor && this.runtimes[descriptor.runtime];
    if (!descriptor || !runtime?.[action]) throw Object.assign(new Error(`Silo '${id}' does not support ${action}`), { status: 404 });
    return runtime[action](id);
  }

  async startPairing({ baseUrl, name }) {
    return new AgensisClient({ baseUrl, fetchImpl: this.fetch }).startPairing({ name });
  }

  async exchangePairing({ baseUrl, deviceCode }) {
    const client = new AgensisClient({ baseUrl, fetchImpl: this.fetch });
    const integration = await client.exchangeDeviceCode(deviceCode);
    return this.integrationStore.save({ ...integration, baseUrl });
  }

  async createJob(job) {
    const integrations = await this.integrations();
    const integration = integrations.find((item) => item.workspaceId === job.workspaceId) || integrations[0];
    if (!integration) throw Object.assign(new Error('Pair Farm with an Agensis workspace first'), { status: 503 });
    await this.wakeManagedAgent(integration, job.agentId);
    return this.client(integration).createJob({ ...job, workspaceId: integration.workspaceId });
  }

  async wakeManagedAgent(integration, agentId) {
    if (!agentId) return null;
    const silos = await this.listSilos();
    const silo = silos.find((candidate) => (
      candidate.management === 'managed'
      && candidate.agensis?.workspaceId === integration.workspaceId
      && candidate.agensis?.agentId === agentId
    ));
    if (!silo) return null;
    if (silo.lifecycle === 'deleted') throw Object.assign(new Error(`Managed silo '${silo.id}' was deleted`), { status: 410 });
    // Persisted runtime state is not proof that the Agensis daemon is live.
    // Only a descriptor merged with a current connection may bypass resume.
    if (silo.connectionId && silo.lifecycle === 'running' && ['online', 'busy'].includes(silo.status)) return silo;
    const runtime = this.runtimes[silo.runtime];
    if (!runtime?.start) throw Object.assign(new Error(`Managed silo '${silo.id}' cannot be resumed`), { status: 503 });
    await runtime.start(silo.id);

    const deadline = Date.now() + this.runtimeWakeTimeoutMs;
    do {
      const connection = (await this.client(integration).listSilos()).find((candidate) => (
        String(candidate.agent_id) === String(agentId)
        && ['online', 'busy'].includes(candidate.status)
      ));
      if (connection) return connection;
      if (Date.now() >= deadline) break;
      await this.delay(Math.min(1000, Math.max(1, deadline - Date.now())));
    } while (Date.now() <= deadline);
    throw Object.assign(new Error(`Managed silo '${silo.id}' resumed but its Agensis daemon did not reconnect`), { status: 504 });
  }

  async getJob(jobId, workspaceId) {
    const integration = (await this.integrations()).find((item) => !workspaceId || item.workspaceId === workspaceId);
    if (!integration) throw Object.assign(new Error('Agensis workspace is not paired'), { status: 404 });
    return this.client(integration).getJob(jobId);
  }

  async cancelJob(jobId, workspaceId) {
    const integration = (await this.integrations()).find((item) => !workspaceId || item.workspaceId === workspaceId);
    if (!integration) throw Object.assign(new Error('Agensis workspace is not paired'), { status: 404 });
    return this.client(integration).cancelJob(jobId);
  }
}
