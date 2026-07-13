import test from 'node:test';
import assert from 'node:assert/strict';

import { E2BRuntime } from '../src/runtimes/e2b.mjs';

test('E2B creation enrolls a one-time Agensis agent and auto-pauses after 15 minutes', async () => {
  const records = [];
  const commands = [];
  const sandbox = {
    sandboxId: 'sbx-1',
    commands: { run: async (command, options) => commands.push({ command, options }) },
  };
  const sdk = { Sandbox: { create: async (...args) => { records.push(args); return sandbox; } } };
  const registry = { put: async (descriptor) => descriptor };
  const agensisClient = {
    enrollAgent: async () => ({
      agent: { id: 'agent-1' },
      connection: { url: 'https://agensis.test', token: 'aga_connection', workspaceId: 'workspace-1', agentId: 'agent-1' },
    }),
  };
  const runtime = new E2BRuntime({ sdk, registry, agensisClient });

  const descriptor = await runtime.create({ name: 'Cloud coder', template: 'base' });
  assert.equal(records[0][0], 'base');
  assert.deepEqual(records[0][1].lifecycle, { onTimeout: 'pause', autoResume: false });
  assert.equal(records[0][1].timeoutMs, 15 * 60_000);
  assert.equal(commands[0].options.background, true);
  assert.equal(commands[0].options.envs.AGENSIS_TOKEN, 'aga_connection');
  assert.equal(descriptor.id, 'e2b/sbx-1');
  assert.equal('token' in JSON.parse(JSON.stringify(descriptor)), false);
});

test('E2B lifecycle resumes before work, pauses explicitly, and permanently kills on delete', async () => {
  const calls = [];
  const sandbox = {
    setTimeout: async (value) => calls.push(['timeout', value]),
    pause: async () => calls.push(['pause']),
    kill: async () => calls.push(['kill']),
  };
  const sdk = { Sandbox: { connect: async (id, options) => { calls.push(['connect', id, options]); return sandbox; } } };
  const registry = { get: async () => ({ id: 'e2b/sbx-1', runtime: 'e2b', sandbox: { id: 'sbx-1' } }), put: async (value) => value };
  const runtime = new E2BRuntime({ sdk, registry, agensisClient: {} });

  await runtime.start('e2b/sbx-1');
  await runtime.pause('e2b/sbx-1');
  await runtime.delete('e2b/sbx-1');
  assert.deepEqual(calls, [
    ['connect', 'sbx-1', { timeoutMs: 15 * 60_000 }],
    ['timeout', 15 * 60_000],
    ['connect', 'sbx-1', { timeoutMs: 15 * 60_000 }],
    ['pause'],
    ['connect', 'sbx-1', { timeoutMs: 15 * 60_000 }],
    ['kill'],
  ]);
});

test('E2B removes a newly-created sandbox when the agent fails to launch', async () => {
  const calls = [];
  const sandbox = {
    sandboxId: 'sbx-orphan',
    commands: { run: async () => { throw new Error('launch failed'); } },
    kill: async () => calls.push('kill'),
  };
  const runtime = new E2BRuntime({
    sdk: { Sandbox: { create: async () => sandbox } },
    registry: { put: async (value) => value },
    agensisClient: {
      enrollAgent: async () => ({ agent: { id: 'agent-1' }, connection: { url: 'https://agensis.test', token: 'secret', workspaceId: 'workspace-1', agentId: 'agent-1' } }),
      revokeAgent: async () => calls.push('revoke'),
    },
  });
  await assert.rejects(() => runtime.create(), /launch failed/);
  assert.deepEqual(calls, ['kill', 'revoke']);
});

test('managed inference sharing requires a config path inside the sandbox', async () => {
  let enrolled = false;
  const runtime = new E2BRuntime({
    sdk: { Sandbox: { create: async () => ({}) } },
    registry: { put: async (value) => value },
    agensisClient: { enrollAgent: async () => { enrolled = true; } },
  });
  await assert.rejects(() => runtime.create({ share: true }), /sharedModelsFile/);
  assert.equal(enrolled, false);
});
