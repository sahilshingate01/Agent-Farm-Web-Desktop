/** Resolve an upstream API key without putting it in gateway.json responses.
 *
 * File-backed credentials are named secrets under `<state>/secrets`; routes
 * never carry arbitrary filesystem paths or inline keys.
 */

import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
} from "node:fs";
import { resolve } from "node:path";

const SAFE_SECRET_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function routeSecretPath(secretId, stateRoot) {
  const id = String(secretId || "").trim();
  if (!id) return null;
  if (!SAFE_SECRET_ID.test(id) || id === "." || id === "..") {
    throw new Error("API key secret must be a safe identifier (letters, numbers, dot, dash, or underscore).");
  }
  const secretsRoot = resolve(stateRoot, "secrets");
  const path = resolve(secretsRoot, `${id}.key`);
  if (!path.startsWith(`${secretsRoot}/`)) {
    throw new Error("API key secret escapes the farm secrets directory.");
  }
  return path;
}

export function readRouteApiKey(route, env = process.env, { stateRoot } = {}) {
  const envName = String(route?.apiKeyEnv || "").trim();
  const environmentKey = envName ? String(env[envName] || "").trim() : "";
  if (environmentKey) return environmentKey;

  if (route?.apiKeyFile) {
    throw new Error(
      `Route '${route?.id || "unknown"}' uses deprecated apiKeyFile. Move the key under the farm state secrets directory and configure apiKeySecret.`,
    );
  }
  if (route?.apiKey) {
    throw new Error(
      `Route '${route?.id || "unknown"}' contains a deprecated inline apiKey. Move it to apiKeyEnv or apiKeySecret.`,
    );
  }

  const path = routeSecretPath(route?.apiKeySecret, stateRoot || env.FARM_STATE || process.cwd());
  if (path) {
    const linkStat = lstatSync(path);
    if (linkStat.isSymbolicLink()) {
      throw new Error(`API key secret must not be a symbolic link: ${path}`);
    }
    const descriptor = openSync(
      path,
      constants.O_RDONLY | (constants.O_NOFOLLOW || 0),
    );
    let key;
    try {
      const stat = fstatSync(descriptor);
      if (!stat.isFile()) throw new Error(`API key secret is not a regular file: ${path}`);
      if ((stat.mode & 0o077) !== 0) {
        throw new Error(`API key secret must be owner-only (chmod 600): ${path}`);
      }
      key = readFileSync(descriptor, "utf8").trim();
    } finally {
      closeSync(descriptor);
    }
    if (!key) throw new Error(`API key file is empty: ${path}`);
    return key;
  }

  const expected = [
    envName,
    route?.apiKeySecret ? `secret '${route.apiKeySecret}'` : null,
  ].filter(Boolean).join(" or ");
  if (!expected) return null;
  throw new Error(`Route '${route?.id || "unknown"}' has no API key${expected ? `. Set ${expected}` : ""}.`);
}
