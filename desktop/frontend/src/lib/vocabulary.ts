/** Farm nomenclature — the ONE place user-facing concept names live.
 *
 *  Dialects: "farm" (default, the fun one) and "stuffy" (boring-people
 *  mode). Persisted under agensis:dialect; a settings toggle can flip it.
 *  High-surface labels (sidebar, palette, page titles, panel headers) read
 *  from here; long-tail prose converges as it gets touched.
 *
 *  NOT covered on purpose: provider usage vocabulary ("session window",
 *  "session refresh") — that's Claude's own 5-hour-window term, a different
 *  concept from Jobs, and renaming it would misdescribe the provider. */

const dialects = {
  farm: {
    crew: "Crew",
    silo: "Silo",
    silos: "Silos",
    siloGroup: "Elevator",
    siloGroups: "Elevators",
    equipment: "Equipment",
    kit: "kit",
    kits: "kits",
    // "Jobs" was too forced for what the list actually is (Sahil Shingate, 2026-07-16):
    // it's every session — Farm-born, silo natives, host natives.
    job: "Session",
    jobs: "Sessions",
    gateway: "Gateway",
    paddock: "Worktree",
    paddocks: "Worktrees",
    rotation: "Rotation",
    wiki: "Wiki",
    harvest: "Harvest",
    /** The task planner (list / board / timeline with dependencies). */
    chore: "Chore",
    chores: "Chores",
    /** Classic agent-definition files/templates (CLI/IDE persona packs). */
    experts: "Experts",
  },
  stuffy: {
    crew: "Overview",
    silo: "Silo",
    silos: "Silos",
    siloGroup: "Group",
    siloGroups: "Groups",
    equipment: "Profiles",
    kit: "profile",
    kits: "profiles",
    job: "Session",
    jobs: "Sessions",
    harvest: "Suggestions",
    gateway: "Gateway",
    paddock: "Worktree",
    paddocks: "Worktrees",
    rotation: "Handoff plan",
    wiki: "Wiki",
    chore: "Task",
    chores: "Tasks",
    experts: "Experts",
  },
} as const;

export type Dialect = keyof typeof dialects;

function activeDialect(): Dialect {
  try {
    const stored = window.localStorage.getItem("agensis:dialect");
    return stored === "stuffy" ? "stuffy" : "farm";
  } catch {
    return "farm";
  }
}

export const vocab: (typeof dialects)["farm"] | (typeof dialects)["stuffy"] =
  dialects[activeDialect()];
