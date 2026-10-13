const SOURCE_IDENTITIES = [
  "buzz",
  "openpath",
  "vibeclaw",
  "almostnode",
  "cluso",
  "blossom",
  "tinyworld",
];

export const PRIVATE_PUBLICATION_PATHS = [
  ".agensis/",
  ".claude/",
  ".codex/",
  ".cursor/",
  ".grok/",
  ".ok/",
  ".opencode/",
  ".pi/",
  ".vscode/",
  "agent-updates/",
  "suggested/",
  "desktop/docs/superpowers/",
  "docs/superpowers/",
];

export const PRIVATE_PUBLICATION_FILES = new Set([
  "AGENSIS_TODO.md",
  "AGENTS.md",
  "docs/pi-subagents-acceptance-report-contract.md",
]);

/**
 * Detect private source identities in prose, paths, and identifiers.
 * `shell.openPath` is an Electron-style OS API used by the vendored editor,
 * not a reference to the unrelated product with the same letters.
 */
export function containsProhibitedSourceIdentity(text) {
  const candidate = String(text || "").replace(/\bshell\.openPath\b/g, "");
  const lower = candidate.toLowerCase();
  return SOURCE_IDENTITIES.some((identity) => lower.includes(identity));
}
