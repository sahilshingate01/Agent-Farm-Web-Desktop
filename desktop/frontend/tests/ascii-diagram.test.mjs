import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

// Strip types and eval the pure helper module for node:test (no ts-node).
const src = readFileSync(new URL("../src/lib/ascii-fences.ts", import.meta.url), "utf8")
  .replace(/^export /gm, "")
  .replace(/: string/g, "")
  .replace(/: boolean/g, "");
const { looksLikeAsciiArt, promoteAsciiFences } = new Function(
  `${src}; return { looksLikeAsciiArt, promoteAsciiFences };`,
)();

const diagram = `┌─ Host (macOS) ─────────────────────────────────────────────┐
│  farm  ·  farm setup  ·  farm equip                        │
└────────────────────────────────────────────────────────────┘
         ▼
   shared work/`;

test("detects box-drawing diagrams", () => {
  assert.equal(looksLikeAsciiArt(diagram), true);
  assert.equal(looksLikeAsciiArt("hello\nworld\nfoo"), false);
});

test("promotes bare fences that look like diagrams to ascii", () => {
  const md = `# Title\n\n\`\`\`\n${diagram}\n\`\`\`\n\nMore.`;
  const out = promoteAsciiFences(md);
  assert.match(out, /```ascii\n/);
  assert.ok(out.includes("```ascii\n┌"));
});

test("leaves bash fences alone", () => {
  const md = "```bash\necho hi\n```";
  assert.equal(promoteAsciiFences(md), md);
});
