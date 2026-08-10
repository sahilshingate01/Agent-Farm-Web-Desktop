/** Model catalog — the ONE place provider CLIs and their models live.
 *
 *  Nothing in the farm discovers models (recon 2026-07-15): silo rows, the
 *  composer cascade (silo → provider → model → effort), and permission
 *  subtitles all read from here. The built-in catalog can be extended or
 *  corrected without a rebuild via `~/.claude-farm/models.json` (same shape,
 *  keyed by provider id, deep-merged in `mergeCatalog`) — bootstrap delivers
 *  that override as `data.catalog`.
 */

import type { FarmPermission } from "@/types/farm";

export interface CatalogModel {
  id: string;
  label: string;
  /** Effort/reasoning tiers this model accepts, low → high. Absent = no effort control. */
  efforts?: string[];
  defaultEffort?: string;
  /** Total context window in tokens. Marks the models big enough to hold a
   *  conversation as an anchor (ExecutionWorkflow kind "anchor"). Advisory —
   *  nothing enforces it. */
  contextWindow?: number;
}

export interface CatalogProvider {
  id: string;
  label: string;
  models: CatalogModel[];
  /** What this provider CALLS each of the four permission principles —
   *  shown as the subtitle under the consistent main titles. */
  permissionNames: Record<FarmPermission, string>;
}

const CLAUDE_EFFORTS = ["low", "medium", "high", "xhigh", "max"];
const CODEX_EFFORTS = ["minimal", "low", "medium", "high", "xhigh"];

export const BUILTIN_CATALOG: CatalogProvider[] = [
  {
    id: "claude",
    label: "Claude",
    models: [
      { id: "claude-fable-5", label: "Fable 5", efforts: CLAUDE_EFFORTS, defaultEffort: "high", contextWindow: 200_000 },
      { id: "claude-opus-5", label: "Opus 5", efforts: CLAUDE_EFFORTS, defaultEffort: "medium", contextWindow: 200_000 },
      // The [1m] variants are what an anchor wants — one model holding a long
      // conversation while workers rotate underneath it.
      { id: "claude-opus-5[1m]", label: "Opus 5 (1M)", efforts: CLAUDE_EFFORTS, defaultEffort: "medium", contextWindow: 1_000_000 },
      { id: "claude-sonnet-5", label: "Sonnet 5", efforts: CLAUDE_EFFORTS, defaultEffort: "medium", contextWindow: 200_000 },
      { id: "claude-sonnet-5[1m]", label: "Sonnet 5 (1M)", efforts: CLAUDE_EFFORTS, defaultEffort: "medium", contextWindow: 1_000_000 },
      { id: "claude-haiku-4-5", label: "Haiku 4.5", efforts: ["low", "medium", "high"], defaultEffort: "medium", contextWindow: 200_000 },
    ],
    permissionNames: {
      "read-only": "plan mode",
      ask: "default — asks before edits",
      auto: "acceptEdits",
      full: "bypassPermissions",
    },
  },
  {
    id: "codex",
    label: "Codex",
    models: [
      { id: "gpt-5.6", label: "GPT-5.6", efforts: CODEX_EFFORTS, defaultEffort: "medium" },
      { id: "gpt-5.5", label: "GPT-5.5", efforts: CODEX_EFFORTS, defaultEffort: "medium" },
      { id: "gpt-5.5-codex", label: "GPT-5.5 Codex", efforts: CODEX_EFFORTS, defaultEffort: "medium" },
    ],
    permissionNames: {
      "read-only": "sandbox read-only",
      ask: "approval on-request",
      auto: "never ask · workspace-write",
      full: "danger — bypass approvals and sandbox",
    },
  },
  {
    id: "grok",
    label: "Grok",
    models: [
      { id: "grok-4.5", label: "Grok 4.5" },
      { id: "grok-4", label: "Grok 4" },
      { id: "grok-code-fast-1", label: "Grok Code Fast" },
    ],
    permissionNames: {
      "read-only": "policy prompt only",
      ask: "policy prompt only",
      auto: "policy prompt only",
      full: "policy prompt only",
    },
  },
  {
    id: "gemini",
    label: "Gemini",
    models: [
      { id: "gemini-3-pro", label: "Gemini 3 Pro", contextWindow: 1_000_000 },
      { id: "gemini-3-flash", label: "Gemini 3 Flash", contextWindow: 1_000_000 },
    ],
    permissionNames: {
      "read-only": "policy prompt only",
      ask: "policy prompt only",
      auto: "policy prompt only",
      full: "policy prompt only",
    },
  },
];

/** Deep-merge the state-root override (`~/.claude-farm/models.json`) into the
 *  built-in catalog. Override providers match by id; their models REPLACE the
 *  built-in list when given, permissionNames merge key-by-key. Unknown
 *  provider ids are appended (a whole new CLI can be introduced from config). */
export function mergeCatalog(override: unknown): CatalogProvider[] {
  if (!Array.isArray(override)) return BUILTIN_CATALOG;
  const merged = BUILTIN_CATALOG.map((provider) => {
    const patch = override.find(
      (entry) => entry && typeof entry === "object" && (entry as CatalogProvider).id === provider.id,
    ) as Partial<CatalogProvider> | undefined;
    if (!patch) return provider;
    return {
      ...provider,
      ...(patch.label ? { label: patch.label } : {}),
      ...(Array.isArray(patch.models) && patch.models.length ? { models: patch.models } : {}),
      permissionNames: { ...provider.permissionNames, ...(patch.permissionNames || {}) },
    };
  });
  const known = new Set(merged.map((provider) => provider.id));
  for (const entry of override) {
    const candidate = entry as CatalogProvider;
    if (candidate?.id && !known.has(candidate.id) && Array.isArray(candidate.models)) {
      const names: Partial<Record<FarmPermission, string>> = candidate.permissionNames || {};
      merged.push({
        id: candidate.id,
        label: candidate.label || candidate.id,
        models: candidate.models,
        permissionNames: {
          "read-only": names["read-only"] || "policy prompt only",
          ask: names.ask || "policy prompt only",
          auto: names.auto || "policy prompt only",
          full: names.full || "policy prompt only",
        },
      });
    }
  }
  return merged;
}

export function catalogProvider(catalog: CatalogProvider[], providerId: string): CatalogProvider | null {
  return catalog.find((provider) => provider.id === providerId) || null;
}

export function catalogModel(catalog: CatalogProvider[], providerId: string, modelId: string): CatalogModel | null {
  return catalogProvider(catalog, providerId)?.models.find((model) => model.id === modelId) || null;
}
