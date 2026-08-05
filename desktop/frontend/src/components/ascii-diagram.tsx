import { cn } from "@/lib/utils";

export { looksLikeAsciiArt, promoteAsciiFences } from "@/lib/ascii-fences";

/**
 * Renders fenced ASCII / box-drawing diagrams without code-block chrome
 * (language pill, line numbers, token colors) so alignment stays honest.
 */
export function AsciiDiagram({
  code,
  className,
}: {
  code: string;
  language?: string;
  isIncomplete?: boolean;
  meta?: string;
  className?: string;
}) {
  const body = code.replace(/\n$/, "");
  return (
    <figure
      className={cn(
        "ascii-diagram my-4 overflow-x-auto rounded-xl border border-border/80 bg-card/80 p-4 shadow-[inset_0_1px_0_color-mix(in_srgb,var(--foreground)_4%,transparent)]",
        className,
      )}
      data-streamdown="ascii-diagram"
    >
      <pre className="m-0 min-w-min font-mono text-[0.78rem] leading-[1.4] tracking-[-0.01em] text-foreground/88 [font-feature-settings:'liga'_0,'calt'_0] [font-variant-ligatures:none] whitespace-pre">
        {body}
      </pre>
    </figure>
  );
}
