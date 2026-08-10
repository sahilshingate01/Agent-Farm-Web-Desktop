/** The four permission principles — the ONE source for every permission
 *  selector in the app (composer chip, PermissionStudio, per-pane rows).
 *  Main titles NEVER vary; the provider's own name for a level renders as a
 *  subtitle via permissionSubtitle (model catalog, spec C 2026-07-15). */

import type { FarmPermission } from "@/types/farm";
import { catalogProvider, type CatalogProvider } from "@/lib/model-catalog";

export const PERMISSION_PRINCIPLES: Array<{
  value: FarmPermission;
  title: string;
  description: string;
}> = [
  {
    value: "read-only",
    title: "Read only",
    description: "Inspect and plan — never writes or executes.",
  },
  {
    value: "ask",
    title: "Ask for approval",
    description: "Every consequential action waits for you.",
  },
  {
    value: "auto",
    title: "Approve for me",
    description: "Safe actions auto-approved; risky ones still ask.",
  },
  {
    value: "full",
    title: "Full access",
    description: "YOLO — no prompts, full write and execute.",
  },
];

export function permissionTitle(value: FarmPermission): string {
  return PERMISSION_PRINCIPLES.find((principle) => principle.value === value)?.title || value;
}

/** What the selected model's provider calls this level (e.g. claude "plan
 *  mode", codex "sandbox read-only"). Null when the provider is unknown. */
export function permissionSubtitle(
  catalog: CatalogProvider[],
  providerId: string | null | undefined,
  value: FarmPermission,
): string | null {
  if (!providerId) return null;
  return catalogProvider(catalog, providerId)?.permissionNames[value] || null;
}
