import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { AgensisClient, AgensisIntegrationStore } from './agensis-client.mjs';
import { FarmService } from './farm-service.mjs';
import { SiloRegistry } from './silo-registry.mjs';
import { E2BRuntime, loadE2BSdk } from './runtimes/e2b.mjs';
import { DaytonaRuntime, loadDaytonaClient } from './runtimes/daytona.mjs';

export function defaultStateRoot(env = process.env) {
  if (env.FARM_STATE) return env.FARM_STATE;
  const current = join(homedir(), '.usage-farm');
  const legacy = join(homedir(), '.claude-farm');
  return existsSync(current) || !existsSync(legacy) ? current : legacy;
}

async function readJson(path, fallback = {}) {
  try { return JSON.parse(await readFile(path, 'utf8')); } catch { return fallback; }
}

class RuntimeManager {
  constructor({ Runtime, loadProvider, registry, integrationStore, clientFactory }) {
    this.Runtime = Runtime;
    this.loadProvider = loadProvider;
    this.registry = registry;
    this.integrationStore = integrationStore;
    this.clientFactory = clientFactory;
    this.providerPromise = null;
  }

  provider() {
    this.providerPromise ||= Promise.resolve(this.loadProvider());
    return this.providerPromise;
  }

  async integration(workspaceId) {
    const integrations = await this.integrationStore.list();
    if (workspaceId) {
      const selected = integrations.find((item) => item.workspaceId === workspaceId);
      if (!selected) throw new Error(`Agensis workspace '${workspaceId}' is not paired`);
      return selected;
    }
    if (integrations.length === 1) return integrations[0];
    if (!integrations.length) throw new Error('Pair Farm with an Agensis workspace before creating a managed silo');
    throw new Error('More than one Agensis workspace is paired; pass workspaceId');
  }

  async runtime(workspaceId) {
    const integration = await this.integration(workspaceId);
    return new this.Runtime({
      ...(this.Runtime === E2BRuntime ? { sdk: await this.provider() } : { client: await this.provider() }),
      registry: this.registry,
      agensisClient: this.clientFactory(integration),
    });
  }

  async create(input) {
    return (await this.runtime(input.workspaceId)).create(input);
  }

  async forDescriptor(id) {
    const descriptor = await this.registry.get(id);
    if (!descriptor) throw new Error(`Silo '${id}' was not found`);
    return this.runtime(descriptor.agensis?.workspaceId);
  }

  async start(id) { return (await this.forDescriptor(id)).start(id); }
  async pause(id) { return (await this.forDescriptor(id)).pause(id); }
  async delete(id) { return (await this.forDescriptor(id)).delete(id); }
}

export async function createFarmContext({ stateRoot = defaultStateRoot(), fetchImpl = globalThis.fetch } = {}) {
  const [farmdConfig, gatewayConfig] = await Promise.all([
    readJson(join(stateRoot, 'farmd.json'), {}),
    readJson(join(stateRoot, 'gateway.json'), {}),
  ]);
  const registry = new SiloRegistry({ stateRoot });
  const integrationStore = new AgensisIntegrationStore({ stateRoot });
  const clientFactory = (integration) => new AgensisClient({ ...integration, fetchImpl });
  const common = { registry, integrationStore, clientFactory };
  const runtimes = {
    e2b: new RuntimeManager({ ...common, Runtime: E2BRuntime, loadProvider: loadE2BSdk }),
    daytona: new RuntimeManager({ ...common, Runtime: DaytonaRuntime, loadProvider: loadDaytonaClient }),
  };
  const service = new FarmService({
    registry,
    integrationStore,
    clientFactory,
    runtimes,
    discoveryPolicy: farmdConfig.discovery,
    localGatewayBaseUrl: farmdConfig.localGatewayBaseUrl ?? `http://127.0.0.1:${gatewayConfig.port || 4545}`,
    localGatewayApiKey: farmdConfig.localGatewayApiKey ?? gatewayConfig.apiKey ?? '',
    fetchImpl,
  });
  return {
    stateRoot,
    config: {
      host: farmdConfig.host || '127.0.0.1',
      port: Number(farmdConfig.port || 4546),
      apiKey: farmdConfig.apiKey || '',
      ...farmdConfig,
    },
    registry,
    integrationStore,
    runtimes,
    service,
  };
}
