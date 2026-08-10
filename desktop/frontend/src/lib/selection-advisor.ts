/** Selection advisor — the "happy path" behind AUTO / BEST / ECO in the
 *  composer cascade. Scores silos from their usage evidence (the same
 *  windows the crew page shows) and picks a recommended
 *  silo → provider → model → effort so the pickers can paint the best row
 *  green (--success) and the mode toggle can auto-follow it.
 *
 *  - BEST — strongest model (catalog order is strength order) on the
 *    healthiest silo, top effort.
 *  - ECO  — protect quota: healthiest silo, cheapest model (catalog tail),
 *    lowest effort.
 *  - AUTO — tiered: plenty of headroom → BEST-ish; squeezed → ECO-ish;
 *    in between → middle model, default effort.
 */

import type { FarmAccount, FarmProviderUsage } from "@/types/farm";
import type { CatalogModel, CatalogProvider } from "@/lib/model-catalog";

export type SelectionMode = "auto" | "best" | "eco" | "manual";

export const SELECTION_MODES: Array<{ value: SelectionMode; title: string; description: string }> = [
  { value: "auto", title: "Auto", description: "Farm balances quality against remaining quota." },
  { value: "best", title: "Best", description: "Strongest model on the healthiest silo." },
  { value: "eco", title: "Eco", description: "Optimizes usage — spare silos, light models, low effort." },
  { value: "manual", title: "Manual", description: "Your picks, untouched." },
];

export interface Recommendation {
  account: string | null;
  provider: string | null;
  modelId: string | null;
  effort: string | null;
  /** 0..1 remaining-session headroom of the recommended silo/provider. */
  headroom: number;
  reason: string;
}

function windowRemaining(usage: FarmProviderUsage | undefined, pattern: RegExp): number | null {
  for (const window of usage?.windows || []) {
    if (!pattern.test(window.window)) continue;
    if (typeof window.remainingPercent === "number") return window.remainingPercent / 100;
    if (typeof window.usedPercent === "number") return Math.max(0, 1 - window.usedPercent / 100);
  }
  return null;
}

/** Session headroom floored by the weekly pool — a silo with a fresh session
 *  window but an exhausted week is NOT healthy. Unknown evidence scores a
 *  conservative middle, never a confident extreme. */
export function providerHeadroom(account: FarmAccount, providerId: string): number {
  const usage = account.usage?.find((entry) => entry.provider === providerId);
  const session = windowRemaining(usage, /session|five|hour/i);
  const weekly = windowRemaining(usage, /week/i);
  if (session === null && weekly === null) return 0.5;
  return Math.min(session ?? 1, weekly ?? 1);
}

function pickModel(provider: CatalogProvider, mode: SelectionMode, headroom: number): CatalogModel | null {
  const models = provider.models;
  if (!models.length) return null;
  if (mode === "best") return models[0];
  if (mode === "eco") return models[models.length - 1];
  // auto: tier by headroom
  if (headroom >= 0.5) return models[0];
  if (headroom >= 0.2) return models[Math.min(1, models.length - 1)];
  return models[models.length - 1];
}

function pickEffort(model: CatalogModel | null, mode: SelectionMode, headroom: number): string | null {
  const efforts = model?.efforts;
  if (!model || !efforts?.length) return null;
  if (mode === "best") return efforts[efforts.length - 1];
  if (mode === "eco") return efforts[0];
  if (headroom >= 0.5) return model.defaultEffort || efforts[Math.floor(efforts.length / 2)];
  return efforts[0];
}

export function recommendSelection(
  mode: SelectionMode,
  accounts: FarmAccount[],
  catalog: CatalogProvider[],
): Recommendation {
  if (mode === "manual" || !accounts.length) {
    return { account: null, provider: null, modelId: null, effort: null, headroom: 0, reason: "Manual picks." };
  }
  // Catalog order is provider preference order; the healthiest
  // silo×provider pair wins, providers breaking ties.
  let bestPair: { account: string; provider: CatalogProvider; headroom: number } | null = null;
  for (const provider of catalog) {
    for (const account of accounts) {
      if (!account.providers.includes(provider.id)) continue;
      const headroom = providerHeadroom(account, provider.id);
      if (!bestPair || headroom > bestPair.headroom + 1e-9) {
        bestPair = { account: account.name, provider, headroom };
      }
    }
  }
  if (!bestPair) {
    return { account: null, provider: null, modelId: null, effort: null, headroom: 0, reason: "No silos available." };
  }
  const model = pickModel(bestPair.provider, mode, bestPair.headroom);
  const effort = pickEffort(model, mode, bestPair.headroom);
  const percent = Math.round(bestPair.headroom * 100);
  const reason = mode === "eco"
    ? `Sparing quota: ${bestPair.account} has the most headroom (${percent}%).`
    : mode === "best"
      ? `Strongest model on ${bestPair.account} (${percent}% session headroom).`
      : `Balanced pick for ${bestPair.account} at ${percent}% headroom.`;
  return {
    account: bestPair.account,
    provider: bestPair.provider.id,
    modelId: model?.id || null,
    effort,
    headroom: bestPair.headroom,
    reason,
  };
}
