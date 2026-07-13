import test from 'node:test';
import assert from 'node:assert/strict';

import { FarmService } from '../src/farm-service.mjs';

test('service merges persisted silos with configurable Agensis discovery', async () => {
  const registry = { list: async () => [{ id: 'e2b/sbx-1', runtime: 'e2b', lifecycle: 'paused' }] };
  const integrationStore = { list: async () => [{ workspaceId: 'workspace-1', token: 'secret', baseUrl: 'https://agensis.test' }] };
  const clientFactory = () => ({ listSilos: async () => [
    { id: 'connection-1', agent_id: 'agent-1', workspace_id: 'workspace-1', name: 'Desk', status: 'online', farmManaged: false, capabilities: { shared: true, sharedModels: [{ id: 'qwen', shared: true }] } },
    { id: 'connection-2', agent_id: 'agent-2', workspace_id: 'workspace-1', name: 'Hidden', status: 'online', farmManaged: false, capabilities: { codingRoute: true, shared: false } },
  ] });
  const service = new FarmService({ registry, integrationStore, clientFactory });

  service.discoveryPolicy.includeCoding = false;
  assert.deepEqual((await service.listSilos()).map((silo) => silo.id), ['agensis/workspace-1/agent-1', 'e2b/sbx-1']);
  service.discoveryPolicy.includeAllDaemons = true;
  assert.deepEqual((await service.listSilos()).map((silo) => silo.id), ['agensis/workspace-1/agent-1', 'agensis/workspace-1/agent-2', 'e2b/sbx-1']);
});

test('service exposes shared Agensis models and heterogeneous crew routing', async () => {
  const requests = [];
  const integration = { workspaceId: 'workspace-1', token: 'secret', baseUrl: 'https://agensis.test' };
  const remote = {
    listSharedModels: async () => ({ data: [] }),
    openChatCompletion: async (request) => {
      requests.push(request);
      return new Response(JSON.stringify({ model: request.model, choices: [{ message: { content: 'remote' } }] }), { headers: { 'content-type': 'application/json' } });
    },
  };
  remote.listSharedModels = async () => [
    { id: 'agensis/workspace-1/agent-1/qwen', object: 'model', owned_by: 'agensis:agent-1', farm: { workspaceId: 'workspace-1', agentId: 'agent-1', capabilities: ['text', 'tools'], maxConcurrency: 2, activeInference: 0, status: 'online' } },
  ];
  const service = new FarmService({
    registry: { list: async () => [] },
    integrationStore: { list: async () => [integration] },
    clientFactory: () => remote,
    localGatewayBaseUrl: '',
  });

  const models = await service.listModels();
  assert.deepEqual(models.data.map((model) => model.id), ['crew', 'agensis/workspace-1/agent-1/qwen']);
  const response = await service.complete({ model: 'crew', messages: [{ role: 'user', content: 'hi' }], tools: [{ type: 'function' }] });
  assert.equal(response.status, 200);
  assert.equal(requests[0].model, 'agensis/workspace-1/agent-1/qwen');
  assert.equal(requests[0].workspaceId, 'workspace-1');
});

test('a Farm-managed sandbox is not duplicated by its Agensis connection', async () => {
  const registry = { list: async () => [{ id: 'e2b/sbx-1', runtime: 'e2b', lifecycle: 'running', agensis: { workspaceId: 'workspace-1', agentId: 'agent-1' } }] };
  const integrationStore = { list: async () => [{ workspaceId: 'workspace-1', token: 'secret', baseUrl: 'https://agensis.test' }] };
  const clientFactory = () => ({ listSilos: async () => [{ id: 'connection-1', agent_id: 'agent-1', workspace_id: 'workspace-1', name: 'Cloud', status: 'online', farmManaged: true, runtime: 'e2b', capabilities: { shared: true, codingRoute: true, sharedModels: [] } }] });
  const service = new FarmService({ registry, integrationStore, clientFactory, localGatewayBaseUrl: '' });
  const silos = await service.listSilos();
  assert.deepEqual(silos.map((silo) => silo.id), ['e2b/sbx-1']);
  assert.equal(silos[0].connectionId, 'connection-1');
});

test('an offline managed cloud connection is represented as paused instead of losing its runtime state', async () => {
  const registry = { list: async () => [{ id: 'e2b/sbx-1', runtime: 'e2b', management: 'managed', lifecycle: 'running', status: 'online', agensis: { workspaceId: 'workspace-1', agentId: 'agent-1' } }] };
  const integrationStore = { list: async () => [{ workspaceId: 'workspace-1', token: 'secret', baseUrl: 'https://agensis.test' }] };
  const clientFactory = () => ({ listSilos: async () => [{ id: 'connection-1', agent_id: 'agent-1', workspace_id: 'workspace-1', status: 'offline', farmManaged: true, runtime: 'e2b', capabilities: { codingRoute: true } }] });
  const service = new FarmService({ registry, integrationStore, clientFactory, localGatewayBaseUrl: '' });
  const [silo] = await service.listSilos();
  assert.equal(silo.lifecycle, 'paused');
  assert.equal(silo.status, 'paused');
});

test('crew requires streaming capability for streaming requests', async () => {
  const requests = [];
  const integration = { workspaceId: 'workspace-1', token: 'secret', baseUrl: 'https://agensis.test' };
  const remote = {
    listSharedModels: async () => [
      { id: 'text-only', farm: { workspaceId: 'workspace-1', capabilities: ['text'], maxConcurrency: 1, status: 'online' } },
      { id: 'streaming', farm: { workspaceId: 'workspace-1', capabilities: ['text', 'streaming'], maxConcurrency: 1, status: 'busy' } },
    ],
    openChatCompletion: async (request) => {
      requests.push(request);
      return new Response('{}', { headers: { 'content-type': 'application/json' } });
    },
  };
  const service = new FarmService({ registry: { list: async () => [] }, integrationStore: { list: async () => [integration] }, clientFactory: () => remote, localGatewayBaseUrl: '' });
  await service.complete({ model: 'crew', stream: true, messages: [{ role: 'user', content: 'hi' }] });
  assert.equal(requests[0].model, 'streaming');
});

test('dispatch wakes a paused managed silo and waits for its daemon before creating the job', async () => {
  let started = false;
  const calls = [];
  const descriptor = { id: 'daytona/sbx-1', runtime: 'daytona', management: 'managed', lifecycle: 'paused', status: 'paused', agensis: { workspaceId: 'workspace-1', agentId: 'agent-1' } };
  const registry = { list: async () => [descriptor] };
  const integration = { workspaceId: 'workspace-1', token: 'secret', baseUrl: 'https://agensis.test' };
  const remote = {
    listSilos: async () => [{ id: 'connection-1', agent_id: 'agent-1', workspace_id: 'workspace-1', status: started ? 'online' : 'offline', farmManaged: true, runtime: 'daytona', capabilities: { codingRoute: true } }],
    createJob: async (job) => { calls.push(job); return { id: 'job-1', status: 'running' }; },
  };
  const service = new FarmService({
    registry,
    integrationStore: { list: async () => [integration] },
    clientFactory: () => remote,
    runtimes: { daytona: { start: async () => { started = true; return { ...descriptor, lifecycle: 'running', status: 'online' }; } } },
    localGatewayBaseUrl: '',
    delayImpl: async () => {},
  });
  const job = await service.createJob({ workspaceId: 'workspace-1', agentId: 'agent-1', prompt: 'work' });
  assert.equal(job.id, 'job-1');
  assert.equal(started, true);
  assert.equal(calls.length, 1);
});

test('dispatch resumes a persisted online runtime when no live Agensis connection exists', async () => {
  let starts = 0;
  let connected = false;
  const descriptor = { id: 'e2b/sbx-1', runtime: 'e2b', management: 'managed', lifecycle: 'running', status: 'online', agensis: { workspaceId: 'workspace-1', agentId: 'agent-1' } };
  const integration = { workspaceId: 'workspace-1', token: 'secret', baseUrl: 'https://agensis.test' };
  const remote = {
    listSilos: async () => connected ? [{ id: 'connection-1', agent_id: 'agent-1', workspace_id: 'workspace-1', status: 'online', farmManaged: true, runtime: 'e2b', capabilities: { codingRoute: true } }] : [],
    createJob: async () => ({ id: 'job-1', status: 'running' }),
  };
  const service = new FarmService({
    registry: { list: async () => [descriptor] },
    integrationStore: { list: async () => [integration] },
    clientFactory: () => remote,
    runtimes: { e2b: { start: async () => { starts += 1; connected = true; } } },
    localGatewayBaseUrl: '',
    delayImpl: async () => {},
  });

  const [before] = await service.listSilos();
  assert.equal(before.lifecycle, 'paused');
  await service.createJob({ workspaceId: 'workspace-1', agentId: 'agent-1', prompt: 'work' });
  assert.equal(starts, 1);
});
