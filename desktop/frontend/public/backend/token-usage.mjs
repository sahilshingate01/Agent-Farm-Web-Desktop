/** Provider-correct token usage normalization.
 *
 * Canonical invariants:
 * - `input_tokens` is inclusive of cache reads/writes.
 * - cache counters are subsets of input, never additions to an inclusive total.
 * - a reported zero is distinct from a field the provider did not report.
 * - provider totals are tagged; derived display totals never masquerade as a
 *   genuine provider-reported `total_tokens`.
 */

const DIALECTS = new Set(["auto", "anthropic-exclusive", "openai-inclusive", "mixed"]);

function finiteNumber(value) {
  if (
    value === null
    || value === undefined
    || typeof value === "boolean"
    || (typeof value === "string" && !value.trim())
  ) return undefined;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : undefined;
}

function firstNumber(values) {
  for (const value of values) {
    const number = finiteNumber(value);
    if (number !== undefined) return { value: number, reported: true };
  }
  return { value: 0, reported: false };
}

function nested(source, outer, leaf) {
  return source?.[outer]?.[leaf];
}

function cacheCreationBreakdown(source) {
  const detail = source?.cache_creation;
  if (!detail || typeof detail !== "object") return null;
  const fiveMinutes = finiteNumber(detail.ephemeral_5m_input_tokens);
  const oneHour = finiteNumber(detail.ephemeral_1h_input_tokens);
  if (fiveMinutes === undefined && oneHour === undefined) return null;
  return {
    fiveMinutes: fiveMinutes || 0,
    oneHour: oneHour || 0,
    fiveMinutesReported: fiveMinutes !== undefined,
    oneHourReported: oneHour !== undefined,
    total: (fiveMinutes || 0) + (oneHour || 0),
  };
}

function usageSource(value) {
  if (!value || typeof value !== "object") return null;
  const candidates = [
    value.usage,
    value.message?.usage,
    value.event?.usage,
    value.event?.message?.usage,
    value.response?.usage,
    value.result?.usage,
    value.data?.usage,
    value.info?.total_token_usage,
    value.info?.totalTokenUsage,
    value,
  ];
  return candidates.find((candidate) => candidate && typeof candidate === "object") || null;
}

function inferDialect(source, requested) {
  if (DIALECTS.has(requested) && requested !== "auto") return requested;
  if (
    source.prompt_tokens !== undefined
    || source.promptTokens !== undefined
    || source.prompt_tokens_details
    || source.promptTokensDetails
    || source.input_tokens_details
    || source.inputTokensDetails
  ) return "openai-inclusive";
  if (
    source.cache_read_input_tokens !== undefined
    || source.cache_creation_input_tokens !== undefined
    || source.cache_creation
  ) return "anthropic-exclusive";
  return "openai-inclusive";
}

export function cacheStatus({
  read = 0,
  write = 0,
  readReported = false,
  writeReported = false,
} = {}) {
  if (read > 0) return "hit";
  if (write > 0) return "write";
  // A provider-reported zero read is sufficient evidence of a miss. OpenAI
  // reports cached reads but has no corresponding cache-write counter.
  if (readReported) return "miss";
  return "unreported";
}

function canonicalUsage(source) {
  return source
    && typeof source === "object"
    && typeof source.usage_dialect === "string"
    && "cached_input_tokens_reported" in source
    && "cache_creation_input_tokens_reported" in source;
}

/** Normalize a provider event or usage object into the gateway's canonical
 * inclusive representation. */
export function normalizeProviderUsage(value, requestedDialect = "auto") {
  const source = usageSource(value);
  if (!source) return null;
  if (canonicalUsage(source)) return { ...source };

  const input = firstNumber([
    source.input_tokens,
    source.inputTokens,
    source.prompt_tokens,
    source.promptTokens,
  ]);
  const output = firstNumber([
    source.output_tokens,
    source.outputTokens,
    source.completion_tokens,
    source.completionTokens,
  ]);
  const read = firstNumber([
    source.cache_read_input_tokens,
    source.cached_input_tokens,
    source.cachedInputTokens,
    source.cacheReadInputTokens,
    nested(source, "prompt_tokens_details", "cached_tokens"),
    nested(source, "promptTokensDetails", "cachedTokens"),
    nested(source, "input_tokens_details", "cached_tokens"),
    nested(source, "inputTokensDetails", "cachedTokens"),
  ]);
  const cacheCreation = cacheCreationBreakdown(source);
  const write = firstNumber([
    source.cache_creation_input_tokens,
    source.cacheCreationInputTokens,
    source.cache_write_input_tokens,
    source.cacheWriteInputTokens,
    source.cache_write_tokens,
    source.cacheWriteTokens,
    nested(source, "prompt_tokens_details", "cache_write_tokens"),
    nested(source, "promptTokensDetails", "cacheWriteTokens"),
    nested(source, "input_tokens_details", "cache_write_tokens"),
    nested(source, "inputTokensDetails", "cacheWriteTokens"),
    cacheCreation?.total,
  ]);
  const total = firstNumber([source.total_tokens, source.totalTokens]);
  if (![input, output, read, write, total].some((field) => field.reported)) return null;

  const dialect = inferDialect(source, requestedDialect);
  const inclusiveInput = dialect === "anthropic-exclusive"
    ? input.value + read.value + write.value
    : input.value;
  const displayTotal = total.reported ? total.value : inclusiveInput + output.value;
  return {
    input_tokens: inclusiveInput,
    output_tokens: output.value,
    cached_input_tokens: read.value,
    cache_creation_input_tokens: write.value,
    ...(cacheCreation
      ? {
        cache_creation_5m_input_tokens: cacheCreation.fiveMinutes,
        cache_creation_1h_input_tokens: cacheCreation.oneHour,
        cache_creation_5m_input_tokens_reported: cacheCreation.fiveMinutesReported,
        cache_creation_1h_input_tokens_reported: cacheCreation.oneHourReported,
      }
      : {}),
    total_tokens: displayTotal,
    cached_input_tokens_reported: read.reported,
    cache_creation_input_tokens_reported: write.reported,
    total_tokens_reported: total.reported,
    usage_dialect: dialect,
    cache_status: cacheStatus({
      read: read.value,
      write: write.value,
      readReported: read.reported,
      writeReported: write.reported,
    }),
    estimated: false,
  };
}

/** Estimate the net input-side savings of cache reads after paying the cache
 * write premium. Defaults match Anthropic's five-minute cache multipliers:
 * writes cost 1.25x base input and reads cost 0.1x. A negative result is
 * intentional—the first write has not paid back until a later request hits. */
export function estimateCacheSavings(value, {
  baseInputUsdPerMillion = null,
  cacheWriteMultiplier = 1.25,
  cacheWrite5mMultiplier = 1.25,
  cacheWrite1hMultiplier = 2,
  cacheReadMultiplier = 0.1,
  requireKnownWriteTtl = false,
} = {}) {
  const usage = canonicalUsage(value)
    ? value
    : normalizeProviderUsage(value, value?.usage_dialect || "auto");
  if (
    !usage
    || (
      usage.cached_input_tokens_reported !== true
      && usage.cache_creation_input_tokens_reported !== true
    )
  ) return null;

  const read = finiteNumber(usage.cached_input_tokens) || 0;
  const write = finiteNumber(usage.cache_creation_input_tokens) || 0;
  const writeMultiplier = finiteNumber(cacheWriteMultiplier) ?? 1.25;
  const write5mMultiplier = finiteNumber(cacheWrite5mMultiplier) ?? 1.25;
  const write1hMultiplier = finiteNumber(cacheWrite1hMultiplier) ?? 2;
  const readMultiplier = finiteNumber(cacheReadMultiplier) ?? 0.1;
  const write5m = finiteNumber(usage.cache_creation_5m_input_tokens) || 0;
  const write1h = finiteNumber(usage.cache_creation_1h_input_tokens) || 0;
  const unspecifiedWrite = Math.max(0, write - write5m - write1h);
  if (requireKnownWriteTtl && unspecifiedWrite > 0) return null;
  const baseline = read + write;
  const saved = read * (1 - readMultiplier)
    - write5m * (write5mMultiplier - 1)
    - write1h * (write1hMultiplier - 1)
    - unspecifiedWrite * (writeMultiplier - 1);
  const price = finiteNumber(baseInputUsdPerMillion);
  return {
    cacheable_input_tokens: baseline,
    cache_net_input_tokens_saved: saved,
    cache_savings_rate: baseline ? saved / baseline : 0,
    cache_savings_usd: price === undefined ? null : (saved / 1_000_000) * price,
    cache_write_multiplier: writeMultiplier,
    cache_write_5m_multiplier: write5mMultiplier,
    cache_write_1h_multiplier: write1hMultiplier,
    cache_read_multiplier: readMultiplier,
    cache_savings_estimated: true,
  };
}

export function sumTokenUsage(values) {
  const items = values.filter(Boolean);
  if (!items.length) return null;
  const dialects = new Set(items.map((item) => item.usage_dialect).filter(Boolean));
  const usage = {
    input_tokens: items.reduce((sum, item) => sum + (item.input_tokens || 0), 0),
    output_tokens: items.reduce((sum, item) => sum + (item.output_tokens || 0), 0),
    cached_input_tokens: items.reduce((sum, item) => sum + (item.cached_input_tokens || 0), 0),
    cache_creation_input_tokens: items.reduce((sum, item) => sum + (item.cache_creation_input_tokens || 0), 0),
    total_tokens: items.reduce((sum, item) => sum + (item.total_tokens || 0), 0),
    cached_input_tokens_reported: items.every((item) => item.cached_input_tokens_reported === true),
    cache_creation_input_tokens_reported: items.every((item) => item.cache_creation_input_tokens_reported === true),
    total_tokens_reported: items.every((item) => item.total_tokens_reported === true),
    usage_dialect: dialects.size === 1 ? [...dialects][0] : "mixed",
    estimated: items.some((item) => item.estimated),
  };
  const hasFiveMinuteBreakdown = items.some(
    (item) => item.cache_creation_5m_input_tokens_reported !== undefined,
  );
  const hasOneHourBreakdown = items.some(
    (item) => item.cache_creation_1h_input_tokens_reported !== undefined,
  );
  if (hasFiveMinuteBreakdown) {
    usage.cache_creation_5m_input_tokens = items.reduce(
      (sum, item) => sum + (item.cache_creation_5m_input_tokens || 0),
      0,
    );
    usage.cache_creation_5m_input_tokens_reported = items.every(
      (item) => item.cache_creation_5m_input_tokens_reported === true,
    );
  }
  if (hasOneHourBreakdown) {
    usage.cache_creation_1h_input_tokens = items.reduce(
      (sum, item) => sum + (item.cache_creation_1h_input_tokens || 0),
      0,
    );
    usage.cache_creation_1h_input_tokens_reported = items.every(
      (item) => item.cache_creation_1h_input_tokens_reported === true,
    );
  }
  return {
    ...usage,
    cache_status: cacheStatus({
      read: usage.cached_input_tokens,
      write: usage.cache_creation_input_tokens,
      readReported: usage.cached_input_tokens_reported,
      writeReported: usage.cache_creation_input_tokens_reported,
    }),
  };
}

/** Merge cumulative snapshots from one provider stream. Counts use maxima,
 * while a missing provider total is reconstructed for display from the merged
 * inclusive input/output fields. */
export function mergeUsageSnapshots(previous, next) {
  if (!previous) return next ? { ...next } : null;
  if (!next) return { ...previous };
  const totalReported = previous.total_tokens_reported || next.total_tokens_reported;
  const usage = {
    input_tokens: Math.max(previous.input_tokens || 0, next.input_tokens || 0),
    output_tokens: Math.max(previous.output_tokens || 0, next.output_tokens || 0),
    cached_input_tokens: Math.max(previous.cached_input_tokens || 0, next.cached_input_tokens || 0),
    cache_creation_input_tokens: Math.max(
      previous.cache_creation_input_tokens || 0,
      next.cache_creation_input_tokens || 0,
    ),
    cached_input_tokens_reported:
      previous.cached_input_tokens_reported || next.cached_input_tokens_reported,
    cache_creation_input_tokens_reported:
      previous.cache_creation_input_tokens_reported || next.cache_creation_input_tokens_reported,
    total_tokens_reported: totalReported,
    usage_dialect: previous.usage_dialect === next.usage_dialect
      ? previous.usage_dialect
      : previous.usage_dialect && next.usage_dialect
        ? "mixed"
        : previous.usage_dialect || next.usage_dialect || "mixed",
    estimated: previous.estimated || next.estimated,
  };
  if (
    previous.cache_creation_5m_input_tokens_reported !== undefined
    || next.cache_creation_5m_input_tokens_reported !== undefined
  ) {
    usage.cache_creation_5m_input_tokens = Math.max(
      previous.cache_creation_5m_input_tokens || 0,
      next.cache_creation_5m_input_tokens || 0,
    );
    usage.cache_creation_5m_input_tokens_reported = Boolean(
      previous.cache_creation_5m_input_tokens_reported
      || next.cache_creation_5m_input_tokens_reported,
    );
  }
  if (
    previous.cache_creation_1h_input_tokens_reported !== undefined
    || next.cache_creation_1h_input_tokens_reported !== undefined
  ) {
    usage.cache_creation_1h_input_tokens = Math.max(
      previous.cache_creation_1h_input_tokens || 0,
      next.cache_creation_1h_input_tokens || 0,
    );
    usage.cache_creation_1h_input_tokens_reported = Boolean(
      previous.cache_creation_1h_input_tokens_reported
      || next.cache_creation_1h_input_tokens_reported,
    );
  }
  usage.total_tokens = totalReported
    ? Math.max(previous.total_tokens || 0, next.total_tokens || 0)
    : usage.input_tokens + usage.output_tokens;
  return {
    ...usage,
    cache_status: cacheStatus({
      read: usage.cached_input_tokens,
      write: usage.cache_creation_input_tokens,
      readReported: usage.cached_input_tokens_reported,
      writeReported: usage.cache_creation_input_tokens_reported,
    }),
  };
}
