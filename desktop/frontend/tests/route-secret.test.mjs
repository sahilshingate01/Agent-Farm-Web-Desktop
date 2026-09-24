import assert from "node:assert/strict";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { readRouteApiKey } = await import("../public/backend/route-secret.mjs");

function secretFixture(name = "anthropic-direct") {
  const root = mkdtempSync(join(tmpdir(), "farm-route-secret-"));
  const secrets = join(root, "secrets");
  mkdirSync(secrets, { mode: 0o700 });
  const path = join(secrets, `${name}.key`);
  writeFileSync(path, "secret-value\n", { mode: 0o600 });
  return { root, path };
}

test("reads a direct-route key from a named owner-only state secret", () => {
  const { root } = secretFixture();
  assert.equal(
    readRouteApiKey(
      { id: "direct", apiKeySecret: "anthropic-direct" },
      {},
      { stateRoot: root },
    ),
    "secret-value",
  );
});

test("refuses a route secret readable by group or other users", () => {
  const { root, path } = secretFixture();
  chmodSync(path, 0o644);
  assert.throws(
    () => readRouteApiKey(
      { id: "direct", apiKeySecret: "anthropic-direct" },
      {},
      { stateRoot: root },
    ),
    /owner-only/,
  );
});

test("environment credentials take precedence without reading the state secret", () => {
  assert.equal(
    readRouteApiKey(
      { id: "direct", apiKeyEnv: "ANTHROPIC_API_KEY", apiKeySecret: "missing" },
      { ANTHROPIC_API_KEY: "from-env" },
      { stateRoot: "/does/not/exist" },
    ),
    "from-env",
  );
});

test("blank environment credentials fall through to the state secret", () => {
  const { root } = secretFixture();
  assert.equal(
    readRouteApiKey(
      {
        id: "direct",
        apiKeyEnv: "ANTHROPIC_API_KEY",
        apiKeySecret: "anthropic-direct",
      },
      { ANTHROPIC_API_KEY: "   " },
      { stateRoot: root },
    ),
    "secret-value",
  );
});

test("rejects unsafe secret identifiers and arbitrary legacy file paths", () => {
  const { root, path } = secretFixture();
  assert.throws(
    () => readRouteApiKey(
      { id: "direct", apiKeySecret: "../anthropic-direct" },
      {},
      { stateRoot: root },
    ),
    /safe identifier/,
  );
  assert.throws(
    () => readRouteApiKey(
      { id: "direct", apiKeyFile: path },
      {},
      { stateRoot: root },
    ),
    /apiKeySecret/,
  );
  assert.throws(
    () => readRouteApiKey(
      { id: "direct", apiKey: "inline-secret" },
      {},
      { stateRoot: root },
    ),
    /inline apiKey/,
  );
});

test("refuses a symlink even when its target is an owner-only file", () => {
  const root = mkdtempSync(join(tmpdir(), "farm-route-secret-"));
  const secrets = join(root, "secrets");
  mkdirSync(secrets, { mode: 0o700 });
  const target = join(root, "outside.key");
  writeFileSync(target, "outside-secret\n", { mode: 0o600 });
  symlinkSync(target, join(secrets, "linked.key"));
  assert.throws(
    () => readRouteApiKey(
      { id: "direct", apiKeySecret: "linked" },
      {},
      { stateRoot: root },
    ),
    /symbolic link/,
  );
});

test("a keyless local-compatible route remains supported", () => {
  assert.equal(
    readRouteApiKey(
      { id: "local-openai" },
      {},
      { stateRoot: "/does/not/matter" },
    ),
    null,
  );
});
