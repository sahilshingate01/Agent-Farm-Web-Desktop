import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SiloRegistry, normalizeAgensisSilos } from '../src/silo-registry.mjs';

test('the registry persists managed runtime records without mixing secrets into descriptors', async () => {
  const root = await mkdtemp(join(tmpdir(), 'farm-registry-'));
  const registry = new SiloRegistry({ stateRoot: root });
  await registry.put({
    id: 'e2b/sbx-1',
    name: 'Cloud worker',
    runtime: 'e2b',
    management: 'managed',
    locality: 'cloud',
    lifecycle: 'paused',
    sandbox: { provider: 'e2b', id: 'sbx-1' },
    secrets: { apiKey: 'must-not-leak' },
    metadata: {
      accessToken: 'also-private',
      accesstoken: 'lowercase-private',
      apikey: 'lowercase-private',
      clientsecret: 'lowercase-private',
      API_KEY: 'still-private',
      nested: [{ clientSecret: 'private' }, { password: 'private' }],
      monkey: 'public-value',
    },
  });

  const descriptor = await registry.get('e2b/sbx-1');
  assert.equal(descriptor.name, 'Cloud worker');
  assert.equal('secrets' in descriptor, false);
  assert.deepEqual(descriptor.metadata, { nested: [{}, {}], monkey: 'public-value' });

  const reloaded = new SiloRegistry({ stateRoot: root });
  assert.equal((await reloaded.get('e2b/sbx-1')).sandbox.id, 'sbx-1');
});

test('Agensis discovery includes coding daemons by default and remains policy configurable', () => {
  const connections = [
    {
      id: 'connection-1', agent_id: 'agent-1', workspace_id: 'workspace-1', name: 'Managed', handle: 'managed', status: 'online',
      farmManaged: true, runtime: 'e2b', capabilities: { shared: true, codingRoute: true, sharedModels: [{ id: 'qwen', shared: true }] },
    },
    {
      id: 'connection-2', agent_id: 'agent-2', workspace_id: 'workspace-1', name: 'External', handle: 'external', status: 'online',
      farmManaged: false, runtime: 'external-agent', capabilities: { shared: false, codingRoute: true, sharedModels: [] },
    },
  ];

  const defaults = normalizeAgensisSilos(connections, { includeShared: true, includeCoding: true, includeAllDaemons: false, includeFarmManaged: true });
  assert.deepEqual(defaults.map((silo) => silo.id), ['agensis/workspace-1/agent-1', 'agensis/workspace-1/agent-2']);

  const all = normalizeAgensisSilos(connections, { includeShared: true, includeAllDaemons: true, includeFarmManaged: true });
  assert.deepEqual(all.map((silo) => silo.id), ['agensis/workspace-1/agent-1', 'agensis/workspace-1/agent-2']);

  const managedOnly = normalizeAgensisSilos(connections, { includeShared: false, includeCoding: false, includeAllDaemons: false, includeFarmManaged: true });
  assert.deepEqual(managedOnly.map((silo) => silo.id), ['agensis/workspace-1/agent-1']);
});

test('busy Agensis daemons remain running and routable', () => {
  const [silo] = normalizeAgensisSilos([{
    id: 'connection-1', agent_id: 'agent-1', workspace_id: 'workspace-1', status: 'busy',
    capabilities: { codingRoute: true },
  }], { includeCoding: true });
  assert.equal(silo.status, 'busy');
  assert.equal(silo.lifecycle, 'running');
});
