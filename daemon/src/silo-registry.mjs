import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const SECRET_WORDS = new Set(['credential', 'credentials', 'key', 'password', 'secret', 'secrets', 'token']);
const SECRET_COMPOUNDS = new Set([
  'accesstoken', 'apikey', 'authtoken', 'bearertoken', 'clientsecret',
  'credentialhash', 'passwordhash', 'privatekey', 'refreshtoken',
  'secretkey', 'signingkey',
]);

function isSecretKey(key) {
  const words = String(key)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^a-zA-Z0-9]+/)
    .map((word) => word.toLowerCase())
    .filter(Boolean);
  return words.some((word) => SECRET_WORDS.has(word)) || SECRET_COMPOUNDS.has(words.join(''));
}

function publicDescriptor(value) {
  if (Array.isArray(value)) return value.map(publicDescriptor);
  if (!value || typeof value !== 'object') return value;

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !isSecretKey(key))
      .map(([key, entry]) => [key, publicDescriptor(entry)]),
  );
}

function descriptorDirectory(root, id) {
  return join(root, 'silos', encodeURIComponent(id));
}

export class SiloRegistry {
  constructor({ stateRoot }) {
    if (!stateRoot) throw new TypeError('stateRoot is required');
    this.stateRoot = stateRoot;
  }

  async put(descriptor) {
    if (!descriptor?.id || typeof descriptor.id !== 'string') {
      throw new TypeError('A silo descriptor requires a string id');
    }

    const safe = publicDescriptor(descriptor);
    const directory = descriptorDirectory(this.stateRoot, safe.id);
    const target = join(directory, 'silo.json');
    const temporary = join(directory, `.silo-${process.pid}-${Date.now()}.json`);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeFile(temporary, `${JSON.stringify(safe, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, target);
    return safe;
  }

  async get(id) {
    try {
      return JSON.parse(await readFile(join(descriptorDirectory(this.stateRoot, id), 'silo.json'), 'utf8'));
    } catch (error) {
      if (error?.code === 'ENOENT') return null;
      throw error;
    }
  }

  async list() {
    let entries;
    try {
      entries = await readdir(join(this.stateRoot, 'silos'), { withFileTypes: true });
    } catch (error) {
      if (error?.code === 'ENOENT') return [];
      throw error;
    }

    const descriptors = await Promise.all(
      entries.filter((entry) => entry.isDirectory()).map(async (entry) => {
        try {
          return JSON.parse(await readFile(join(this.stateRoot, 'silos', entry.name, 'silo.json'), 'utf8'));
        } catch (error) {
          if (error?.code === 'ENOENT' || error instanceof SyntaxError) return null;
          throw error;
        }
      }),
    );
    return descriptors.filter(Boolean).sort((left, right) => left.id.localeCompare(right.id));
  }
}

export function normalizeAgensisSilos(connections, policy = {}) {
  const {
    includeShared = true,
    includeCoding = true,
    includeAllDaemons = false,
    includeFarmManaged = true,
  } = policy;
  const silos = new Map();

  for (const connection of connections ?? []) {
    const capabilities = connection?.capabilities ?? {};
    const sharedModels = Array.isArray(capabilities.sharedModels)
      ? capabilities.sharedModels.filter((model) => model?.shared !== false)
      : [];
    const shared = capabilities.shared === true || sharedModels.length > 0;
    const coding = capabilities.codingRoute === true;
    if (!(includeAllDaemons || (includeShared && shared) || (includeCoding && coding) || (includeFarmManaged && connection.farmManaged))) continue;
    if (!connection?.workspace_id || !connection?.agent_id) continue;

    const id = `agensis/${connection.workspace_id}/${connection.agent_id}`;
    silos.set(id, {
      id,
      name: connection.name || connection.handle || connection.agent_id,
      runtime: connection.runtime || 'agensis-agent',
      management: connection.farmManaged ? 'managed' : 'external',
      locality: connection.locality || (connection.runtime === 'local' ? 'local' : 'remote'),
      lifecycle: ['online', 'busy'].includes(connection.status) ? 'running' : connection.status === 'paused' ? 'paused' : 'offline',
      status: connection.status || 'offline',
      workspaceId: connection.workspace_id,
      agentId: connection.agent_id,
      connectionId: connection.id,
      capabilities: {
        codingRoute: coding,
        shared,
        sharedModels,
      },
    });
  }

  return [...silos.values()].sort((left, right) => left.id.localeCompare(right.id));
}
