import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

// Strip TS types enough for new Function eval (no ts-node in node:test).
const src = readFileSync(new URL("../src/lib/document-language.ts", import.meta.url), "utf8")
  .replace(/\/\*\*[\s\S]*?\*\//g, "")
  .replace(/^export interface[\s\S]*?^}/gm, "")
  .replace(/^export /gm, "")
  .replace(/: string \| null \| undefined/g, "")
  .replace(/: string \| null/g, "")
  .replace(/: string/g, "")
  .replace(/: boolean/g, "")
  .replace(/: ClaudeWorkflowMeta \| null/g, "")
  .replace(/as ClaudeWorkflowMeta/g, "")
  .replace(/Array<\{[\s\S]*?\}>/g, "[]");

const {
  languageFromPath,
  isMarkdownPath,
  looksLikeClaudeWorkflow,
  parseClaudeWorkflowMeta,
} = new Function(
  `${src}; return { languageFromPath, isMarkdownPath, looksLikeClaudeWorkflow, parseClaudeWorkflowMeta };`,
)();

test("languageFromPath maps common extensions", () => {
  assert.equal(languageFromPath("a/b/c.js"), "javascript");
  assert.equal(languageFromPath("foo.md"), "markdown");
  assert.equal(languageFromPath("x.yaml"), "yaml");
});

test("detects Claude Code workflows", () => {
  const path = "/workspace/.claude/workflows/escalation-chain.js";
  const content = `export const meta = {
  name: 'escalation-chain',
  description: 'Plan then execute',
  whenToUse: 'Hard tasks',
  phases: [
    { title: 'Plan', detail: 'think', model: 'claude-haiku-4-5' },
    { title: 'Execute', detail: 'do it', model: 'claude-sonnet-4-6' },
  ],
}

phase('Plan')
const plan = await agent('hi')
`;
  assert.equal(looksLikeClaudeWorkflow(path, content), true);
  const meta = parseClaudeWorkflowMeta(content);
  assert.equal(meta.name, "escalation-chain");
  assert.equal(meta.phases.length, 2);
  assert.equal(meta.phases[0].title, "Plan");
});

test("markdown path heuristic", () => {
  assert.equal(isMarkdownPath("docs/a.md"), true);
  assert.equal(isMarkdownPath("workflows/x.js"), false);
});
