#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { createFarmContext } from '../src/context.mjs';
import { createFarmdServer } from '../src/farmd.mjs';

const context = await createFarmContext();
const host = process.env.FARMD_HOST || context.config.host;
const port = Number(process.env.FARMD_PORT || context.config.port);
const server = createFarmdServer({ service: context.service, apiKey: context.config.apiKey, host });

server.on('error', (error) => {
  process.stderr.write(`farmd: ${error.message}\n`);
  process.exitCode = 1;
});
server.listen(port, host, async () => {
  await mkdir(context.stateRoot, { recursive: true, mode: 0o700 });
  await writeFile(join(context.stateRoot, 'farmd-runtime.json'), `${JSON.stringify({ pid: process.pid, host, port, command: process.argv[1], service: 'farmd', startedAt: new Date().toISOString() }, null, 2)}\n`, { mode: 0o600 });
  process.stderr.write(`farmd: listening on http://${host}:${port}\n`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => server.close(() => process.exit(0)));
}
