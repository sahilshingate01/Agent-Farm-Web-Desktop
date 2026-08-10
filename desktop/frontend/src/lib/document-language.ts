/** Map a filesystem path to a Streamdown/shiki language id for code view. */
export function languageFromPath(path: string | null | undefined): string | null {
  if (!path) return null;
  const base = path.split(/[\\/]/).pop() || path;
  const lower = base.toLowerCase();
  // Extensionless special names first.
  if (/^(agents|claude|soul|memory|skill)$/i.test(lower)) return "markdown";
  const dot = lower.lastIndexOf(".");
  if (dot < 0) return null;
  const ext = lower.slice(dot + 1);
  switch (ext) {
    case "md":
    case "mdx":
    case "markdown":
      return "markdown";
    case "js":
    case "cjs":
    case "mjs":
      return "javascript";
    case "ts":
      return "typescript";
    case "tsx":
      return "tsx";
    case "jsx":
      return "jsx";
    case "json":
      return "json";
    case "yml":
    case "yaml":
      return "yaml";
    case "sh":
    case "bash":
    case "zsh":
      return "bash";
    case "toml":
      return "toml";
    case "py":
      return "python";
    case "rs":
      return "rust";
    case "go":
      return "go";
    case "css":
      return "css";
    case "html":
    case "htm":
      return "html";
    case "svg":
      return "xml";
    case "txt":
      return "text";
    default:
      return null;
  }
}

export function isMarkdownPath(path: string | null | undefined): boolean {
  const lang = languageFromPath(path);
  return lang === "markdown" || lang === null;
}

/** Heuristic: Claude Code workflow modules export a `meta` object with phases. */
export function looksLikeClaudeWorkflow(path: string, content: string): boolean {
  if (!/\.(m?js|cjs)$/i.test(path)) return false;
  if (!/export\s+const\s+meta\s*=/.test(content)) return false;
  // Either under a workflows directory or has the typical phases array.
  return /(?:^|[\\/])workflows(?:[\\/]|$)/i.test(path) || /phases\s*:\s*\[/.test(content);
}

export interface ClaudeWorkflowMeta {
  name?: string;
  description?: string;
  whenToUse?: string;
  phases: Array<{ title?: string; detail?: string; model?: string }>;
}

/**
 * Best-effort parse of `export const meta = { ... }` from a Claude Code
 * workflow module. Uses Function only on the object literal (no full file
 * eval) so host/runtime globals like `args` / `agent` never run.
 */
export function parseClaudeWorkflowMeta(content: string): ClaudeWorkflowMeta | null {
  const match = /export\s+const\s+meta\s*=\s*(\{[\s\S]*?\n\})\s*(?:;|\n|$)/.exec(content);
  if (!match) return null;
  try {
    // Object literal only — no imports, no free identifiers beyond JSON-ish JS.
    const value = Function(`"use strict"; return (${match[1]});`)() as ClaudeWorkflowMeta;
    if (!value || typeof value !== "object") return null;
    const phases = Array.isArray(value.phases) ? value.phases : [];
    return {
      name: typeof value.name === "string" ? value.name : undefined,
      description: typeof value.description === "string" ? value.description : undefined,
      whenToUse: typeof value.whenToUse === "string" ? value.whenToUse : undefined,
      phases: phases.filter((phase) => phase && typeof phase === "object"),
    };
  } catch {
    return null;
  }
}
