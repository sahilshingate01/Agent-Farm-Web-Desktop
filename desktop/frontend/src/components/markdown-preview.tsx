import { ChevronRightIcon } from "lucide-react";
import { FarmStreamdown } from "@/lib/streamdown";

/**
 * Split a leading YAML frontmatter block off a markdown document. Returns
 * top-level `key: value` pairs (nested/list lines fold into the owning
 * key's value) so the preview can render an OK-style properties table
 * instead of letting `---` fences parse as setext headings.
 */
export function splitFrontmatter(content: string): {
  pairs: [string, string][];
  raw: string;
  body: string;
} | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
  if (!match) return null;
  const raw = match[1];
  const pairs: [string, string][] = [];
  for (const line of raw.split(/\r?\n/)) {
    const pair = /^([A-Za-z0-9_.-]+):\s?(.*)$/.exec(line);
    if (pair) {
      pairs.push([pair[1], pair[2]]);
    } else if (pairs.length && line.trim()) {
      const last = pairs[pairs.length - 1];
      last[1] = last[1] ? `${last[1]} ${line.trim()}` : line.trim();
    }
  }
  return { pairs, raw, body: content.slice(match[0].length) };
}

/**
 * Structured view of an agent-definition description value: prose paragraphs
 * plus the `<example>` blocks Claude agent frontmatter embeds, with literal
 * `\n` escapes normalized to real breaks. Returns null when the value has no
 * such structure so plain values keep the mono one-liner treatment.
 */
export function parseStructuredValue(
  value: string,
): { paragraphs: string[]; examples: string[][] } | null {
  if (!value.includes("\\n") && !value.includes("<example>")) return null;
  // splitFrontmatter folds `description: |` blocks into "| <text>" — drop
  // the YAML block-scalar indicator before treating the rest as prose.
  const normalized = value.replace(/^[|>][+-]?\s*/, "").replace(/\\n/g, "\n");
  const examples: string[][] = [];
  const prose = normalized.replace(
    /<example>([\s\S]*?)<\/example>/g,
    (_block, inner: string) => {
      // One line per turn: Context / user / assistant / commentary, whether
      // the source had real newlines or ran the turns together.
      const lines = inner
        .replace(/<commentary>/g, "commentary: ")
        .replace(/<\/commentary>/g, "")
        .replace(/\s*\b(Context|user|assistant|commentary):\s*/g, "\n$1: ")
        .split("\n")
        .map((line) => line.replace(/\s+/g, " ").trim())
        .filter(Boolean);
      if (lines.length) examples.push(lines);
      return "\n\n";
    },
  );
  const paragraphs = prose
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
    // The disclosure below already announces the examples — drop the
    // now-dangling "Examples:" lead-in.
    .map((paragraph) => paragraph.replace(/\bExamples?:$/i, "").trim())
    .filter(Boolean);
  return { paragraphs, examples };
}

/** Collapsed "N usage examples" disclosure for the properties card. */
function ValueExamples({ examples }: { examples: string[][] }) {
  return (
    <details className="group mt-1.5">
      <summary className="flex cursor-pointer select-none list-none items-center gap-1 type-label">
        <ChevronRightIcon className="size-3 shrink-0 transition-transform group-open:rotate-90" />
        {examples.length === 1 ? "1 usage example" : `${examples.length} usage examples`}
      </summary>
      <div className="mt-1.5 grid gap-1.5">
        {examples.map((lines, index) => (
          <div
            key={index}
            className="rounded-md border bg-background/60 px-2.5 py-2"
          >
            {lines.map((line, lineIndex) => (
              <p key={lineIndex} className="break-words type-caption">
                {line}
              </p>
            ))}
          </div>
        ))}
      </div>
    </details>
  );
}

/** Markdown preview that renders YAML frontmatter as a properties card
 *  (muted type-label keys, mono values) above the rendered body. */
export function MarkdownPreview({
  content,
  docPath,
}: {
  content: string;
  /** Workspace-relative path of the open doc — resolves relative images. */
  docPath?: string;
}) {
  const frontmatter = splitFrontmatter(content);
  if (!frontmatter) {
    return <FarmStreamdown docPath={docPath}>{content}</FarmStreamdown>;
  }
  return (
    <>
      {frontmatter.pairs.length ? (
        <dl className="mb-6 overflow-hidden rounded-lg border bg-muted/30">
          {frontmatter.pairs.map(([key, value], index) => {
            const items = /^- /.test(value) ? value.split(/\s*- /).filter(Boolean) : null;
            const structured = items ? null : parseStructuredValue(value);
            return (
              <div
                key={`${key}-${index}`}
                className="flex items-baseline gap-3 border-b border-border/60 px-3 py-1.5 last:border-b-0"
              >
                <dt
                  className="w-32 shrink-0 truncate font-secondary text-[0.7rem] font-medium uppercase tracking-[0.1em] text-muted-foreground/80"
                  title={key}
                >
                  {key}
                </dt>
                {items ? (
                  <dd className="flex min-w-0 flex-1 flex-wrap gap-1">
                    {items.map((item) => (
                      <span
                        key={item}
                        className="rounded-md border bg-background px-1.5 py-px font-mono text-xs"
                      >
                        {item.trim()}
                      </span>
                    ))}
                  </dd>
                ) : structured ? (
                  <dd className="min-w-0 flex-1 py-0.5">
                    {structured.paragraphs.map((paragraph, paragraphIndex) => (
                      <p
                        key={paragraphIndex}
                        className="mt-1.5 break-words type-body first:mt-0"
                      >
                        {paragraph}
                      </p>
                    ))}
                    {structured.examples.length > 0 && (
                      <ValueExamples examples={structured.examples} />
                    )}
                  </dd>
                ) : (
                  <dd className="min-w-0 flex-1 break-words font-mono type-caption text-foreground">
                    {value || "—"}
                  </dd>
                )}
              </div>
            );
          })}
        </dl>
      ) : (
        <pre className="mb-6 overflow-x-auto rounded-lg border bg-muted/40 p-3 font-mono type-caption">
          {frontmatter.raw}
        </pre>
      )}
      <FarmStreamdown docPath={docPath}>{frontmatter.body}</FarmStreamdown>
    </>
  );
}
