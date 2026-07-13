import { claudePermissionMode } from './permission-modes.mjs';

const DEFAULT_TIMEOUT_MS = 15 * 60_000;

function connectCommand({ share = false, sharedModelsFile = '', codingCmd = '', model = '', permissionMode = '' } = {}) {
  const args = [
    'exec npx --yes agensis-cli@latest connect',
    '--url "$AGENSIS_URL"',
    '--token "$AGENSIS_TOKEN"',
    '--workspace "$AGENSIS_WORKSPACE_ID"',
    '--agent "$AGENSIS_AGENT_ID"',
    '--cwd "${FARM_WORKSPACE:-/home/user}"',
  ];
  if (codingCmd) args.push('--coding-cmd "$AGENSIS_CODING_CMD"');
  else args.push('--no-coding');
  if (model) args.push('--model "$AGENSIS_MODEL"');
  if (permissionMode) args.push('--permission-mode "$AGENSIS_PERMISSION_MODE"');
  if (share) args.push('--share');
  if (sharedModelsFile) args.push('--shared-models-file "$AGENSIS_SHARED_MODELS_FILE"');
  return args.join(' ');
}

export class E2BRuntime {
  constructor({ sdk, registry, agensisClient, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    if (!sdk?.Sandbox) throw new TypeError('The E2B SDK is required');
    if (!registry) throw new TypeError('A silo registry is required');
    if (!agensisClient) throw new TypeError('An Agensis client is required');
    this.sdk = sdk;
    this.registry = registry;
    this.agensisClient = agensisClient;
    this.timeoutMs = timeoutMs;
  }

  async create({ name = 'E2B silo', template, share = false, sharedModelsFile = '', workspace = '/home/user', codingCmd = '', model = '', permissionMode = '', metadata = {} } = {}) {
    if (share && !sharedModelsFile) throw new TypeError('sharedModelsFile is required when inference sharing is enabled');
    permissionMode = claudePermissionMode(permissionMode);
    const enrollment = await this.agensisClient.enrollAgent({
      name,
      runtime: 'e2b',
      description: 'Farm-managed E2B coding silo',
      metadata,
    });
    let sandbox;
    try {
      const createOptions = {
        timeoutMs: this.timeoutMs,
        lifecycle: { onTimeout: 'pause', autoResume: false },
        metadata: { ...metadata, agensisAgentId: enrollment.agent.id },
      };
      sandbox = template
        ? await this.sdk.Sandbox.create(template, createOptions)
        : await this.sdk.Sandbox.create(createOptions);
      await sandbox.commands.run(connectCommand({ share, sharedModelsFile, codingCmd, model, permissionMode }), {
        background: true,
        envs: {
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
      return await this.registry.put({
        id: `e2b/${sandbox.sandboxId}`,
        name,
        runtime: 'e2b',
        management: 'managed',
        locality: 'cloud',
        lifecycle: 'running',
        status: 'online',
        sandbox: { provider: 'e2b', id: sandbox.sandboxId, template: template || null },
        agensis: { workspaceId: enrollment.connection.workspaceId, agentId: enrollment.connection.agentId },
        capabilities: { codingRoute: Boolean(codingCmd), shared: share },
        createdAt: new Date().toISOString(),
      });
    } catch (error) {
      if (sandbox) {
        try {
          if (typeof sandbox.kill === 'function') await sandbox.kill();
          else if (typeof this.sdk.Sandbox.kill === 'function') await this.sdk.Sandbox.kill(sandbox.sandboxId);
        } catch { /* cleanup is best-effort; preserve the launch error */ }
      }
      await this.agensisClient.revokeAgent?.(enrollment.agent.id).catch(() => {});
      throw error;
    }
  }

  async descriptor(id) {
    const descriptor = await this.registry.get(id);
    if (!descriptor?.sandbox?.id || descriptor.runtime !== 'e2b') throw new Error(`E2B silo '${id}' was not found`);
    return descriptor;
  }

  async start(id) {
    const descriptor = await this.descriptor(id);
    const sandbox = await this.sdk.Sandbox.connect(descriptor.sandbox.id, { timeoutMs: this.timeoutMs });
    await sandbox.setTimeout?.(this.timeoutMs);
    return this.registry.put({ ...descriptor, lifecycle: 'running', status: 'online', resumedAt: new Date().toISOString() });
  }

  async pause(id) {
    const descriptor = await this.descriptor(id);
    const sandbox = await this.sdk.Sandbox.connect(descriptor.sandbox.id, { timeoutMs: this.timeoutMs });
    await sandbox.pause();
    return this.registry.put({ ...descriptor, lifecycle: 'paused', status: 'paused', pausedAt: new Date().toISOString() });
  }

  async delete(id) {
    const descriptor = await this.descriptor(id);
    const sandbox = await this.sdk.Sandbox.connect(descriptor.sandbox.id, { timeoutMs: this.timeoutMs });
    await sandbox.kill();
    await this.agensisClient.revokeAgent?.(descriptor.agensis?.agentId).catch(() => {});
    return this.registry.put({ ...descriptor, lifecycle: 'deleted', status: 'offline', deletedAt: new Date().toISOString() });
  }
}

export async function loadE2BSdk() {
  try {
    return await import('e2b');
  } catch (error) {
    throw new Error('E2B support requires the optional "e2b" package. Run npm install in daemon/.', { cause: error });
  }
}
