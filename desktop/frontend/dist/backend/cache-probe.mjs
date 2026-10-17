#!/usr/bin/env node
/** Two-request prompt-cache probe for a configured direct Anthropic route.
 *
 * This intentionally bypasses the desktop gateway listener while reusing the
 * same request mutation and usage normalizer. It proves whether the configured
 * upstream honors the explicit cache markers; it never probes CLI routes,
 * whose provider process owns the wire request.
 *
 * Usage:
 *   node cache-probe.mjs <route-id> [--dry-run] [--prefix-chars=24000]
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { applyAnthropicPromptCaching, countCacheBreakpoints } from "./prompt-cache.mjs";
import { readRouteApiKey } from "./route-secret.mjs";
import {
  estimateCacheSavings,
  normalizeProviderUsage,
  sumTokenUsage,
} from "./token-usage.mjs";

function readJson(path, fallback) {
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return fallback; }
}

function argument(name, fallback) {
  const entry = process.argv.slice(2).find((value) => value.startsWith(`--${name}=`));
  return entry ? entry.slice(name.length + 3) : fallback;
}

function stateRoot() {
  return process.env.FARM_STATE
    || (existsSync(join(homedir(), ".usage-farm"))
      ? join(homedir(), ".usage-farm")
      : join(homedir(), ".claude-farm"));
}

export function probeVerdict(cold, warm) {
  const readReported = Boolean(
    cold?.cached_input_tokens_reported || warm?.cached_input_tokens_reported,
  );
  const writeReported = Boolean(
    cold?.cache_creation_input_tokens_reported
    || warm?.cache_creation_input_tokens_reported,
  );
  if (!readReported && !writeReported) {
    return {
      ok: false,
      status: "unreported",
      message: "The upstream returned no cache read/write counters.",
    };
  }
  if ((warm?.cached_input_tokens || 0) > 0) {
    return {
      ok: true,
      status: "working",
      message: `The second request read ${warm.cached_input_tokens.toLocaleString()} cached tokens.`,
    };
  }
  if ((cold?.cache_creation_input_tokens || 0) > 0 || (warm?.cache_creation_input_tokens || 0) > 0) {
    return {
      ok: false,
      status: "written-not-reused",
      message: "The upstream wrote cache tokens but the identical second request did not read them.",
    };
  }
  if (!readReported) {
    return {
      ok: false,
      status: "unreported",
      message: "The upstream returned no cache-read counter.",
    };
  }
  return {
    ok: false,
    status: "miss",
    message: "The upstream reported cache counters, but both requests were cache misses.",
  };
}

export function probePrefixChars(value = 24_000) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    throw new Error("--prefix-chars must be a whole number.");
  }
  if (parsed < 4_096 || parsed > 32_000) {
    throw new Error("--prefix-chars must be between 4096 and 32000.");
  }
  return parsed;
}

export async function callRoute(route, body, farmStateRoot) {
  const base = String(route.baseUrl || "").replace(/\/$/, "");
  if (!base) throw new Error(`Route '${route.id}' has no baseUrl.`);
  const key = readRouteApiKey(route, process.env, { stateRoot: farmStateRoot });
  const started = Date.now();
  const headers = {
    "content-type": "application/json",
    "anthropic-version": "2023-06-01",
  };
  if (key) headers["x-api-key"] = key;
  const response = await fetch(`${base}/v1/messages`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const value = await response.json();
  if (!response.ok) throw new Error(value?.error?.message || `Upstream returned ${response.status}.`);
  return {
    durationMs: Date.now() - started,
    usage: normalizeProviderUsage(value, "anthropic-exclusive"),
  };
}

async function main() {
  const routeId = process.argv.slice(2).find((value) => !value.startsWith("--"));
  if (!routeId) throw new Error("Usage: node cache-probe.mjs <direct-anthropic-route> [--dry-run] [--prefix-chars=24000]");
  const farmStateRoot = stateRoot();
  const config = readJson(join(farmStateRoot, "gateway.json"), {});
  const route = (Array.isArray(config.routes) ? config.routes : []).find((item) => item?.id === routeId);
  if (!route) throw new Error(`Route '${routeId}' was not found in gateway.json.`);
  if (route.transport !== "anthropic") throw new Error(`Route '${routeId}' is '${route.transport}', not a direct Anthropic route.`);
  if (route.promptCaching === false) throw new Error(`Route '${routeId}' has prompt caching disabled.`);

  // Keep the synthetic item below roughly 8K tokens. It only needs to clear
  // provider cache thresholds; a larger probe wastes quota without evidence.
  const prefixChars = probePrefixChars(argument("prefix-chars", 24_000));
  const unit = "Stable prompt-cache probe prefix. ";
  const stablePrefix = unit.repeat(Math.ceil(prefixChars / unit.length)).slice(0, prefixChars);
  const body = applyAnthropicPromptCaching({
    model: route.upstreamModel,
    max_tokens: 8,
    system: stablePrefix,
    messages: [{ role: "user", content: "Reply with the single word OK." }],
    stream: false,
  });
  const breakpoints = countCacheBreakpoints(body);
  if (process.argv.includes("--dry-run")) {
    console.log(JSON.stringify({ route: route.id, model: route.upstreamModel, prefixChars, breakpoints, dryRun: true }, null, 2));
    return;
  }
  if (!route.upstreamModel) throw new Error(`Route '${routeId}' has no upstreamModel.`);

  const cold = await callRoute(route, body, farmStateRoot);
  const warm = await callRoute(route, body, farmStateRoot);
  const verdict = probeVerdict(cold.usage, warm.usage);
  const savings = estimateCacheSavings(
    sumTokenUsage([cold.usage, warm.usage]),
    {
      baseInputUsdPerMillion: route.baseInputUsdPerMillion,
      cacheWriteMultiplier: 1.25,
    },
  );
  console.log(JSON.stringify({
    route: route.id,
    model: route.upstreamModel,
    prefixChars,
    breakpoints,
    cold,
    warm,
    verdict,
    savings,
  }, null, 2));
  if (!verdict.ok) process.exitCode = 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
