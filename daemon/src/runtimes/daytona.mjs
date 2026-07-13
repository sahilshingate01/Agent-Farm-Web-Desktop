import { claudePermissionMode } from './permission-modes.mjs';

const AGENT_SESSION = 'agensis-agent';

function agentCommand({ share = false, sharedModelsFile = '', codingCmd = '', model = '', permissionMode = '' } = {}) {
  const args = [
    'exec npx --yes agensis-cli@latest connect',
    '--url "$AGENSIS_URL"',
    '--token "$AGENSIS_TOKEN"',
    '--workspace "$AGENSIS_WORKSPACE_ID"',
    '--agent "$AGENSIS_AGENT_ID"',
    '--cwd "${FARM_WORKSPACE:-/home/daytona}"',
  ];
  if (codingCmd) args.push('--coding-cmd "$AGENSIS_CODING_CMD"');
  else args.push('--no-coding');
  if (model) args.push('--model "$AGENSIS_MODEL"');
  if (permissionMode) args.push('--permission-mode "$AGENSIS_PERMISSION_MODE"');
  if (share) args.push('--share');
  if (sharedModelsFile) args.push('--shared-models-file "$AGENSIS_SHARED_MODELS_FILE"');
  return args.join(' ');
}

async function launchAgent(sandbox, options = {}) {
  try { await sandbox.process.createSession(AGENT_SESSION); } catch { /* a stopped sandbox may retain its session record */ }
  return sandbox.process.executeSessionCommand(AGENT_SESSION, {
    command: agentCommand(options),
    runAsync: true,
  });
}

export class DaytonaRuntime {
  constructor({ client, registry, agensisClient } = {}) {
    if (!client) throw new TypeError('A Daytona client is required');
    if (!registry) throw new TypeError('A silo registry is required');
    if (!agensisClient) throw new TypeError('An Agensis client is required');
    this.client = client;
    this.registry = registry;
    this.agensisClient = agensisClient;
  }

  async create({ name = 'Daytona silo', snapshot, image, share = false, sharedModelsFile = '', workspace = '/home/daytona', codingCmd = '', model = '', permissionMode = '', metadata = {} } = {}) {
    if (share && !sharedModelsFile) throw new TypeError('sharedModelsFile is required when inference sharing is enabled');
    permissionMode = claudePermissionMode(permissionMode);
    const enrollment = await this.agensisClient.enrollAgent({ name, runtime: 'daytona', description: 'Farm-managed Daytona coding silo', metadata });
    let sandbox;
    try {
      sandbox = await this.client.create({
        name,
        language: 'typescript',
        ...(snapshot ? { snapshot } : {}),
        ...(image ? { image } : {}),
        autoStopInterval: 15,
        autoDeleteInterval: -1,
        labels: { ...metadata.labels, 'agensis-agent-id': enrollment.agent.id, 'managed-by': 'agensis-farm' },
        envVars: {
          AGENSIS_URL: enrollment.connection.url,
          AGENSIS_TOKEN: enrollment.connection.token,
          AGENSIS_WORKSPACE_ID: enrollment.connection.workspaceId,
          AGENSIS_AGENT_ID: enrollment.connection.agentId,
          FARM_WORKSPACE: workspace,
          ...(codingCmd ? { AGENSIS_CODING_CMD: codingCmd } : {}),
          ...(model ? { AGENSIS_MODEL: model } : {}),
          ...(permissionMode ? { AGENSIS_PERMISSION_MODE: permissionMode } : {}),
          ...(sharedModelsFile ? { AGENSIS_SHARED_MODELS_FILE: sharedModelsFile } : {}),
        },
      });
      await launchAgent(sandbox, { share, sharedModelsFile, codingCmd, model, permissionMode });
      return await this.registry.put({
        id: `daytona/${sandbox.id}`,
        name,
        runtime: 'daytona',
        management: 'managed',
        locality: 'cloud',
        lifecycle: 'running',
        status: 'online',
        sandbox: { provider: 'daytona', id: sandbox.id, snapshot: snapshot || null, image: image || null },
        agensis: { workspaceId: enrollment.connection.workspaceId, agentId: enrollment.connection.agentId },
        capabilities: { codingRoute: Boolean(codingCmd), shared: share },
        launch: { share, sharedModelsFile: sharedModelsFile || null, codingCmd: codingCmd || null, model: model || null, permissionMode: permissionMode || null },
        createdAt: new Date().toISOString(),
      });
    } catch (error) {
      if (sandbox) {
        try {
          if (typeof sandbox.delete === 'function') await sandbox.delete();
          else if (typeof this.client.delete === 'function') await this.client.delete(sandbox);
        } catch { /* cleanup is best-effort; preserve the launch error */ }
      }
      await this.agensisClient.revokeAgent?.(enrollment.agent.id).catch(() => {});
      throw error;
    }
  }

  async descriptor(id) {
    const descriptor = await this.registry.get(id);
    if (!descriptor?.sandbox?.id || descriptor.runtime !== 'daytona') throw new Error(`Daytona silo '${id}' was not found`);
    return descriptor;
  }

  async start(id) {
    const descriptor = await this.descriptor(id);
    const sandbox = await this.client.get(descriptor.sandbox.id);
    if (typeof sandbox.start === 'function') await sandbox.start();
    else await this.client.start(sandbox);
    await launchAgent(sandbox, descriptor.launch ?? {});
    return this.registry.put({ ...descriptor, lifecycle: 'running', status: 'online', resumedAt: new Date().toISOString() });
  }

  async pause(id) {
    const descriptor = await this.descriptor(id);
    const sandbox = await this.client.get(descriptor.sandbox.id);
    if (typeof sandbox.pause === 'function') await sandbox.pause();
    else if (typeof sandbox.stop === 'function') await sandbox.stop();
    else await this.client.stop(sandbox);
    return this.registry.put({ ...descriptor, lifecycle: 'paused', status: 'paused', pausedAt: new Date().toISOString() });
  }

  async delete(id) {
    const descriptor = await this.descriptor(id);
    const sandbox = await this.client.get(descriptor.sandbox.id);
    if (typeof sandbox.delete === 'function') await sandbox.delete();
    else await this.client.delete(sandbox);
    await this.agensisClient.revokeAgent?.(descriptor.agensis?.agentId).catch(() => {});
    return this.registry.put({ ...descriptor, lifecycle: 'deleted', status: 'offline', deletedAt: new Date().toISOString() });
  }
}

export async function loadDaytonaClient() {
  try {
    const { Daytona } = await import('@daytona/sdk');
    return new Daytona();
  } catch (error) {
    throw new Error('Daytona support requires @daytona/sdk and DAYTONA_API_KEY.', { cause: error });
  }
}
