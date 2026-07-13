import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { AgensisClient, AgensisIntegrationStore } from '../src/agensis-client.mjs';

function response(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

test('device pairing starts unauthenticated and exchanges a one-time code', async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).endsWith('/device/start')) {
      return response(201, { deviceCode: 'agd_secret', userCode: 'FARM-ABCD-EFGH', verificationUri: 'https://agensis.test/integrations/farm', interval: 5 });
    }
    return response(200, { token: 'agf_token', integrationId: 'integration-1', workspaceId: 'workspace-1', scopes: ['agents:read'] });
  };
  const client = new AgensisClient({ baseUrl: 'https://agensis.test', fetchImpl });

  const pairing = await client.startPairing({ name: 'Office farm' });
  assert.equal(pairing.userCode, 'FARM-ABCD-EFGH');
  assert.equal('authorization' in calls[0].options.headers, false);

  const integration = await client.exchangeDeviceCode(pairing.deviceCode);
  assert.equal(integration.token, 'agf_token');
  assert.deepEqual(JSON.parse(calls[1].options.body), { deviceCode: 'agd_secret' });
});

test('authenticated requests use the integration token and surface Agensis errors', async () => {
  const calls = [];
  const client = new AgensisClient({
    baseUrl: 'https://agensis.test/',
    token: 'agf_token',
    workspaceId: 'workspace-1',
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      if (String(url).endsWith('/silos')) return response(200, { data: [{ id: 'connection-1' }], error: null });
      return response(403, { error: { code: 'insufficient_scope', message: 'Missing models:read' } });
    },
  });
  assert.deepEqual(await client.listSilos(), [{ id: 'connection-1' }]);
  assert.equal(calls[0].options.headers.authorization, 'Bearer agf_token');
  await assert.rejects(() => client.listSharedModels(), /Missing models:read/);
});

test('integration tokens are stored separately with owner-only permissions', async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), 'farm-agensis-token-'));
  const store = new AgensisIntegrationStore({ stateRoot });
  await store.save({ baseUrl: 'https://agensis.test', token: 'agf_secret', workspaceId: 'workspace-1', integrationId: 'integration-1' });

  const path = join(stateRoot, 'integrations', 'agensis', 'workspace-1.json');
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  assert.match(await readFile(path, 'utf8'), /agf_secret/);
  assert.equal((await store.load('workspace-1')).baseUrl, 'https://agensis.test');
});

test('the public Agensis app URL resolves to its realtime backend API', async () => {
  let requested = '';
  const client = new AgensisClient({ baseUrl: 'https://agensis.io', fetchImpl: async (url) => { requested = String(url); return response(201, { deviceCode: 'agd', userCode: 'FARM-TEST-CODE' }); } });
  await client.startPairing();
  assert.equal(requested, 'https://agensis-backend.fly.dev/backend/integrations/farm/device/start');
});
