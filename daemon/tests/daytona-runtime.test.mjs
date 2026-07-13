import test from 'node:test';
import assert from 'node:assert/strict';

import { DaytonaRuntime } from '../src/runtimes/daytona.mjs';

test('Daytona creates a 15-minute auto-stop sandbox and launches the Agensis agent asynchronously', async () => {
  const created = [];
  const commands = [];
  const sandbox = {
    id: 'daytona-1',
    process: {
      createSession: async (id) => commands.push(['session', id]),
      executeSessionCommand: async (id, request) => commands.push(['command', id, request]),
    },
  };
  const client = { create: async (params) => { created.push(params); return sandbox; } };
  const registry = { put: async (descriptor) => descriptor };
  const agensisClient = { enrollAgent: async () => ({ agent: { id: 'agent-1' }, connection: { url: 'https://agensis.test', token: 'aga_secret', workspaceId: 'workspace-1', agentId: 'agent-1' } }) };
  const runtime = new DaytonaRuntime({ client, registry, agensisClient });

  const descriptor = await runtime.create({ name: 'Daytona coder' });
  assert.equal(created[0].autoStopInterval, 15);
  assert.equal(created[0].envVars.AGENSIS_TOKEN, 'aga_secret');
  assert.equal(commands[1][2].runAsync, true);
  assert.equal(descriptor.id, 'daytona/daytona-1');
  assert.equal(JSON.stringify(descriptor).includes('aga_secret'), false);
});

test('Daytona start relaunches the daemon, pause uses provider pause when available, and delete is terminal', async () => {
  const calls = [];
  const sandbox = {
    start: async () => calls.push('start'),
    pause: async () => calls.push('pause'),
    delete: async () => calls.push('delete'),
    process: {
      createSession: async () => calls.push('session'),
      executeSessionCommand: async () => calls.push('agent'),
    },
  };
  const client = { get: async () => sandbox };
  const registry = { get: async () => ({ id: 'daytona/daytona-1', runtime: 'daytona', sandbox: { id: 'daytona-1' } }), put: async (value) => value };
  const runtime = new DaytonaRuntime({ client, registry, agensisClient: {} });
  await runtime.start('daytona/daytona-1');
  await runtime.pause('daytona/daytona-1');
  await runtime.delete('daytona/daytona-1');
  assert.deepEqual(calls, ['start', 'session', 'agent', 'pause', 'delete']);
});

test('Daytona deletes a newly-created sandbox when the agent fails to launch', async () => {
  const calls = [];
  const sandbox = {
    id: 'daytona-orphan',
    process: {
      createSession: async () => {},
      executeSessionCommand: async () => { throw new Error('launch failed'); },
    },
    delete: async () => calls.push('delete'),
  };
  const runtime = new DaytonaRuntime({
    client: { create: async () => sandbox },
    registry: { put: async (value) => value },
    agensisClient: {
      enrollAgent: async () => ({ agent: { id: 'agent-1' }, connection: { url: 'https://agensis.test', token: 'secret', workspaceId: 'workspace-1', agentId: 'agent-1' } }),
      revokeAgent: async () => calls.push('revoke'),
    },
  });
  await assert.rejects(() => runtime.create(), /launch failed/);
  assert.deepEqual(calls, ['delete', 'revoke']);
});
