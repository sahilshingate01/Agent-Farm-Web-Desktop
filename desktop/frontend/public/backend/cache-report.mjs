#!/usr/bin/env node
/** Prompt-cache evidence report over gateway-activity.jsonl.
 *
 *  Exists because the gateway already RECORDS everything needed to know whether
 *  provider-side prompt caching engages (normalizeUsage parses
 *  cache_read_input_tokens / cache_creation_input_tokens) but nothing ever read
 *  it back. The headline number is `reuse`: cache_read / (read + creation).
 *
 *  The original CLI-route finding was reuse near 0 despite a stable flattened
 *  prefix: the conversation was written every turn and never read. Direct
 *  routes now have explicit breakpoints and a provider-ordered cachePrefixSha,
 *  so interpret their results alongside cacheMode and minimum-size/TTL rules.
 *
 *  Usage:  node cache-report.mjs [path-to-gateway-activity.jsonl]
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { estimateCacheSavings, normalizeProviderUsage } from "./token-usage.mjs";

const num = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);

/** Window promptPrefixSha hashes. Below it the whole prompt IS the prefix, so
 *  it legitimately grows every turn and a differing hash proves nothing —
 *  and a prompt that short is under the provider's minimum cacheable size
 *  anyway. Keep in step with promptPrefixSha() in gateway.mjs. */
export const PREFIX_SAMPLE_CHARS = 4096;

/** Read the cache counters whatever casing the provider used. */
export function cacheTokens(usage) {
  const normalized = normalizeProviderUsage(
    { usage },
    usage?.usage_dialect || "auto",
  );
  if (!normalized) return null;
  return {
    read: normalized.cached_input_tokens,
    creation: normalized.cache_creation_input_tokens,
    input: normalized.input_tokens,
    output: normalized.output_tokens,
    readReported: normalized.cached_input_tokens_reported,
    creationReported: normalized.cache_creation_input_tokens_reported,
    status: normalized.cache_status,
  };
}

/** Group finished requests into per-session turn sequences with derived reuse.
 *  Records without usage are ignored — they never reached a provider. */
export function summarizeCacheEvidence(records) {
  const finished = (Array.isArray(records) ? records : [])
    .filter((row) => row && row.event !== "started" && cacheTokens(row.usage));
  const bySession = new Map();
  for (const row of finished) {
    // Requests with no session id still get grouped, per account+route, so the
    // report is useful for API clients that never send one.
    const key = row.sessionId || `(no-session) ${row.account || "?"} · ${row.route || "?"}`;
    if (!bySession.has(key)) bySession.set(key, []);
    bySession.get(key).push(row);
  }

  const sessions = [];
  for (const [key, rows] of bySession) {
    rows.sort((a, b) => Date.parse(a.occurredAt || a.completedAt || 0) - Date.parse(b.occurredAt || b.completedAt || 0));
    let previousAt = null;
    let previousSha = null;
    let previousChars = null;
    let previousPrefixKind = null;
    let previousComparable = null;
    let previousAccount = null;
    const turns = rows.map((row, index) => {
      const tokens = cacheTokens(row.usage);
      const usageDialect = normalizeProviderUsage(
        { usage: row.usage },
        row.usage?.usage_dialect || "auto",
      )?.usage_dialect;
      const savings = usageDialect === "anthropic-exclusive" || row.transport === "anthropic"
        ? estimateCacheSavings(row.usage, {
          baseInputUsdPerMillion: row.baseInputUsdPerMillion,
          cacheWriteMultiplier: row.cacheWriteMultiplier ?? 1.25,
          requireKnownWriteTtl: row.cacheMode !== "explicit",
        })
        : null;
      const at = Date.parse(row.occurredAt || row.completedAt || 0) || null;
      const gapSeconds = previousAt && at ? Math.round((at - previousAt) / 1000) : null;
      const total = tokens.read + tokens.creation;
      const prefixKind = row.cachePrefixSha ? "provider" : "flattened";
      const prefixSha = row.cachePrefixSha || row.promptPrefixSha;
      const prefixChars = row.cachePrefixSha ? row.cachePrefixChars : row.promptChars;
      // Provider fingerprints end at the first real cache breakpoint and can
      // be compared at any length. Flattened prompt samples are comparable only
      // after both turns clear the fixed sample window.
      const comparable = index > 0
        && Boolean(prefixSha) && Boolean(previousSha)
        && prefixKind === previousPrefixKind
        && row.cachePrefixComparable !== false
        && previousComparable !== false
        && (prefixKind === "provider"
          || (num(prefixChars) >= PREFIX_SAMPLE_CHARS
            && num(previousChars) >= PREFIX_SAMPLE_CHARS));
      const turn = {
        index,
        at: row.occurredAt || row.completedAt || null,
        gapSeconds,
        account: row.account || null,
        route: row.route || null,
        cacheMode: row.cacheMode || "unknown",
        promptChars: row.promptChars ?? null,
        cachePrefixChars: row.cachePrefixChars ?? null,
        prefixKind,
        ...tokens,
        cacheNetInputTokensSaved: savings?.cache_net_input_tokens_saved ?? null,
        cacheSavingsRate: savings?.cache_savings_rate ?? null,
        cacheSavingsUsd: savings?.cache_savings_usd ?? null,
        prefixStable: comparable ? prefixSha === previousSha : null,
        rotated: index > 0 && previousAccount != null && row.account !== previousAccount,
        reuse: total ? Number((tokens.read / total).toFixed(3)) : 0,
      };
      previousAt = at;
      previousSha = prefixSha || previousSha;
      previousChars = prefixChars ?? previousChars;
      previousPrefixKind = prefixSha ? prefixKind : previousPrefixKind;
      previousComparable = prefixSha ? row.cachePrefixComparable : previousComparable;
      previousAccount = row.account ?? previousAccount;
      return turn;
    });
    const read = turns.reduce((sum, turn) => sum + turn.read, 0);
    const creation = turns.reduce((sum, turn) => sum + turn.creation, 0);
    sessions.push({
      key,
      turns,
      totals: {
        turns: turns.length,
        read,
        creation,
        reuse: read + creation ? Number((read / (read + creation)).toFixed(3)) : 0,
        prefixBreaks: turns.filter((turn) => turn.prefixStable === false).length,
        rotations: turns.filter((turn) => turn.rotated).length,
        cacheHits: turns.filter((turn) => turn.read > 0).length,
        cacheWrites: turns.filter((turn) => turn.creation > 0).length,
        cacheMisses: turns.filter((turn) => turn.status === "miss").length,
        cacheUnreported: turns.filter((turn) => turn.status === "unreported").length,
        cacheNetInputTokensSaved: turns.reduce(
          (sum, turn) => sum + Number(turn.cacheNetInputTokensSaved || 0),
          0,
        ),
        cacheSavingsUsd: turns.reduce(
          (sum, turn) => sum + Number(turn.cacheSavingsUsd || 0),
          0,
        ),
        pricedTurns: turns.filter((turn) => turn.cacheSavingsUsd !== null).length,
      },
    });
  }
  sessions.sort((a, b) => b.totals.turns - a.totals.turns);

  const read = sessions.reduce((sum, s) => sum + s.totals.read, 0);
  const creation = sessions.reduce((sum, s) => sum + s.totals.creation, 0);
  return {
    sessions,
    overall: {
      sessions: sessions.length,
      turns: sessions.reduce((sum, s) => sum + s.totals.turns, 0),
      read,
      creation,
      reuse: read + creation ? Number((read / (read + creation)).toFixed(3)) : 0,
      cacheHits: sessions.reduce((sum, session) => sum + session.totals.cacheHits, 0),
      cacheWrites: sessions.reduce((sum, session) => sum + session.totals.cacheWrites, 0),
      cacheMisses: sessions.reduce((sum, session) => sum + session.totals.cacheMisses, 0),
      cacheUnreported: sessions.reduce((sum, session) => sum + session.totals.cacheUnreported, 0),
      cacheNetInputTokensSaved: sessions.reduce(
        (sum, session) => sum + session.totals.cacheNetInputTokensSaved,
        0,
      ),
      cacheSavingsUsd: sessions.reduce(
        (sum, session) => sum + session.totals.cacheSavingsUsd,
        0,
      ),
      pricedTurns: sessions.reduce((sum, session) => sum + session.totals.pricedTurns, 0),
    },
  };
}

export function readActivity(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => { try { return JSON.parse(line); } catch { return null; } })
    .filter(Boolean);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const stateRoot = process.env.FARM_STATE
    || (existsSync(join(homedir(), ".usage-farm")) ? join(homedir(), ".usage-farm") : join(homedir(), ".claude-farm"));
  const path = process.argv[2] || join(stateRoot, "gateway-activity.jsonl");
  const report = summarizeCacheEvidence(readActivity(path));
  const pct = (value) => `${(value * 100).toFixed(1)}%`;
  const money = (value) => `$${value.toFixed(4)}`;
  console.log(`\n${path}`);
  const priced = report.overall.pricedTurns
    ? ` · priced savings ${money(report.overall.cacheSavingsUsd)} across ${report.overall.pricedTurns} turn(s)`
    : "";
  console.log(`overall: ${report.overall.turns} turns across ${report.overall.sessions} sessions · read ${report.overall.read.toLocaleString()} · created ${report.overall.creation.toLocaleString()} · reuse ${pct(report.overall.reuse)} · net saved ${Math.round(report.overall.cacheNetInputTokensSaved).toLocaleString()} base-input-token equivalents${priced} · cache ${report.overall.cacheHits} hit / ${report.overall.cacheWrites} write / ${report.overall.cacheMisses} miss / ${report.overall.cacheUnreported} unreported\n`);
  for (const session of report.sessions.slice(0, 12)) {
    const t = session.totals;
    const sessionPriced = t.pricedTurns ? ` · ${money(t.cacheSavingsUsd)} saved` : "";
    console.log(`${session.key}  —  ${t.turns} turns · reuse ${pct(t.reuse)} · net ${Math.round(t.cacheNetInputTokensSaved).toLocaleString()} token-eq${sessionPriced} · ${t.prefixBreaks} prefix breaks · ${t.rotations} rotations`);
    for (const turn of session.turns.slice(-8)) {
      const flags = [
        turn.prefixStable === false ? "PREFIX-BROKE" : "",
        turn.rotated ? `ROTATED→${turn.account}` : "",
      ].filter(Boolean).join(" ");
      console.log(`   ${String(turn.index).padStart(3)}  ${turn.at?.slice(11, 19) || "--------"}  gap=${turn.gapSeconds === null ? "-" : `${turn.gapSeconds}s`}  mode=${turn.cacheMode}  cache=${turn.status}  read=${turn.read.toLocaleString()}  create=${turn.creation.toLocaleString()}  reuse=${pct(turn.reuse)}  ${flags}`);
    }
    console.log("");
  }
}
