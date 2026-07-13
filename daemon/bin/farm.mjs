#!/usr/bin/env node
import { setTimeout as delay } from 'node:timers/promises';

import { createFarmContext } from '../src/context.mjs';
import { createFarmdServer } from '../src/farmd.mjs';

function optionsFrom(argv) {
  const options = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith('--')) { options._.push(value); continue; }
    const [name, inline] = value.slice(2).split(/=(.*)/s, 2);
    if (name.startsWith('no-')) { options[name.slice(3)] = false; continue; }
    const next = inline ?? argv[index + 1];
    if (inline === undefined && next != null && !next.startsWith('--')) index += 1;
    options[name] = inline !== undefined ? inline : (next != null && !next.startsWith('--') ? next : true);
  }
  return options;
}

function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function usage() {
  return `Agent Farm distributed control plane

  farm serve [--host 127.0.0.1] [--port 4546]
  farm pair --url <agensis-url> [--name <farm-name>]
  farm silos
  farm silo create <e2b|daytona> --name <name> [--template|--snapshot|--image <ref>]
                   [--coding-cmd <command>] [--share --shared-models-file <path>]
  farm silo <start|pause|delete> <silo-id>
  farm models
  farm job run --agent-id <id> --prompt <work> [--workspace-id <id>] [--wait]
  farm job status|cancel <job-id> [--workspace-id <id>]
`;
}

async function main() {
  const [command = 'help', ...rest] = process.argv.slice(2);
  const options = optionsFrom(rest);
  const context = await createFarmContext();
  const service = context.service;

  if (command === 'help' || command === '--help' || command === '-h') {
    process.stdout.write(usage());
    return;
  }
  if (command === 'serve') {
    const host = String(options.host || context.config.host);
    const port = Number(options.port || context.config.port);
    const server = createFarmdServer({ service, apiKey: context.config.apiKey, host });
    server.listen(port, host, () => process.stderr.write(`farmd: listening on http://${host}:${port}\n`));
    return;
  }
  if (command === 'pair') {
    const baseUrl = options.url || process.env.AGENSIS_URL;
    if (!baseUrl) throw new Error('pair requires --url <agensis-url>');
    const pairing = await service.startPairing({ baseUrl, name: options.name || 'Agent Farm' });
    process.stdout.write(`Open ${pairing.verificationUri}\nEnter code ${pairing.userCode}\nWaiting for approval...\n`);
    const deadline = Date.now() + Number(pairing.expiresIn || 600) * 1000;
    while (Date.now() < deadline) {
      await delay(Math.max(1, Number(pairing.interval || 5)) * 1000);
      try {
        const integration = await service.exchangePairing({ baseUrl, deviceCode: pairing.deviceCode });
        print({ paired: true, workspaceId: integration.workspaceId, integrationId: integration.integrationId, baseUrl: integration.baseUrl });
        return;
      } catch (error) {
        if (error.status === 428 || error.code === 'authorization_pending') continue;
        throw error;
      }
    }
    throw new Error('Pairing request expired before it was approved');
  }
  if (command === 'silos') return print({ data: await service.listSilos(), errors: service.lastDiscoveryErrors });
  if (command === 'models') return print(await service.listModels());
  if (command === 'silo') {
    const [action, idOrRuntime] = options._;
    if (action === 'create') {
      const runtime = idOrRuntime;
      if (!runtime) throw new Error('silo create requires e2b or daytona');
      return print({ data: await service.createSilo({
        runtime,
        name: options.name || `${runtime} silo`,
        workspaceId: options['workspace-id'],
        template: options.template,
        snapshot: options.snapshot,
        image: options.image,
        workspace: options.workspace,
        share: options.share === true,
        sharedModelsFile: options['shared-models-file'] || '',
        codingCmd: options['coding-cmd'] || '',
        model: options.model || '',
        permissionMode: options['permission-mode'] || '',
      }) });
    }
    if (!['start', 'pause', 'delete'].includes(action) || !idOrRuntime) throw new Error('Use: farm silo <start|pause|delete> <silo-id>');
    return print({ data: await service.siloAction(idOrRuntime, action) });
  }
  if (command === 'job') {
    const [action, jobId] = options._;
    if (action === 'status') return print({ data: await service.getJob(jobId, options['workspace-id']) });
    if (action === 'cancel') return print({ data: await service.cancelJob(jobId, options['workspace-id']) });
    if (action !== 'run') throw new Error('Use: farm job run, farm job status, or farm job cancel');
    const job = await service.createJob({ workspaceId: options['workspace-id'], agentId: options['agent-id'], prompt: options.prompt, cwd: options.cwd, model: options.model, permissionMode: options['permission-mode'] });
    if (options.wait !== true) return print({ data: job });
    let current = job;
    while (['queued', 'running'].includes(current.status)) {
      await delay(1000);
      current = await service.getJob(current.id, current.workspaceId);
    }
    return print({ data: current });
  }
  throw new Error(`Unknown distributed Farm command '${command}'`);
}

main().catch((error) => {
  process.stderr.write(`farm: ${error?.message || String(error)}\n`);
  process.exitCode = 1;
});
