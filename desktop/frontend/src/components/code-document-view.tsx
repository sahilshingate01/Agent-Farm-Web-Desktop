import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { FarmStreamdown } from "@/lib/streamdown";
import {
  languageFromPath,
  looksLikeClaudeWorkflow,
  parseClaudeWorkflowMeta,
  type ClaudeWorkflowMeta,
} from "@/lib/document-language";
import { cn } from "@/lib/utils";

/**
 * Read-only code surface for non-markdown agentic docs (Claude Code workflow
 * JS modules, JSON agents, shell scripts, …). Wraps content in a fenced
 * Streamdown block so Shiki colours tokens the same way as wiki fences.
 */
export function CodeDocumentView({
  path,
  content,
  className,
}: {
  path: string;
  content: string;
  className?: string;
}) {
  const language = languageFromPath(path) || "text";
  const claudeMeta = useMemo(() => {
    if (!looksLikeClaudeWorkflow(path, content)) return null;
    return parseClaudeWorkflowMeta(content);
  }, [path, content]);

  // Fence the whole file as one code block. Triple-backtick in the source is
  // rare in workflows; if present, lengthen the fence so Streamdown stays intact.
  const fence = content.includes("````") ? "`````" : content.includes("```") ? "````" : "```";
  const fenced = `${fence}${language}\n${content.replace(/\n$/, "")}\n${fence}`;

  return (
    <article className={cn("mx-auto w-full max-w-none px-6 py-8 sm:px-8 lg:px-10", className)}>
      {claudeMeta ? (
        <ClaudeWorkflowHeader meta={claudeMeta} path={path} />
      ) : (
        <header className="mb-5 max-w-4xl">
          <p className="type-label">{language}</p>
          <h1 className="mt-1 text-xl font-semibold tracking-tight break-all">
            {path.split(/[\\/]/).pop() || path}
          </h1>
        </header>
      )}
      <FarmStreamdown className="code-document-source w-full min-w-0" lineNumbers>
        {fenced}
      </FarmStreamdown>
    </article>
  );
}

function ClaudeWorkflowHeader({
  meta,
  path,
}: {
  meta: ClaudeWorkflowMeta;
  path: string;
}) {
  return (
    <header className="mb-6 space-y-4">
      <div className="max-w-3xl">
        <p className="type-label">Claude Code workflow</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          {meta.name || path.split(/[\\/]/).pop() || "Workflow"}
        </h1>
        {meta.description && (
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            {meta.description}
          </p>
        )}
        {meta.whenToUse && (
          <p className="mt-2 type-caption">
            <span className="font-medium text-foreground">When to use: </span>
            {meta.whenToUse}
          </p>
        )}
      </div>
      {meta.phases.length > 0 && (
        <ol className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {meta.phases.map((phase, index) => (
            <li
              key={`${phase.title ?? "phase"}-${index}`}
              className="panel-depth flex gap-3 rounded-lg border bg-card p-3"
            >
              <span className="grid size-7 shrink-0 place-items-center rounded-md bg-foreground font-mono text-xs font-semibold text-background">
                {index + 1}
              </span>
              <div className="min-w-0">
                <h2 className="text-sm font-medium">{phase.title || `Phase ${index + 1}`}</h2>
                {phase.detail && (
                  <p className="mt-0.5 type-caption leading-relaxed">{phase.detail}</p>
                )}
                {phase.model && (
                  <Badge variant="outline" className="mt-2 font-mono text-[0.7rem]">
                    {phase.model}
                  </Badge>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
      <p className="type-caption">
        Runtime DSL (`agent`, `phase`, `args`) — source below, syntax highlighted as JavaScript.
      </p>
    </header>
  );
}
