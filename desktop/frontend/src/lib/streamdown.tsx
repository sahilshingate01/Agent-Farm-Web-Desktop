import { code } from "@streamdown/code";
import type { ComponentProps } from "react";
import { Streamdown } from "streamdown";
import { AsciiDiagram } from "@/components/ascii-diagram";
import { MermaidDiagram } from "@/components/mermaid-diagram";
import { WorkspaceMarkdownImage } from "@/components/workspace-markdown-image";
import { promoteAsciiFences } from "@/lib/ascii-fences";
import { cn } from "@/lib/utils";

/**
 * Shared Streamdown plugins for every markdown surface (wiki preview, chat,
 * reasoning). Without `@streamdown/code`, fenced blocks render as monochrome
 * plaintext even when the fence language is set (e.g. ```bash).
 */
export const streamdownPlugins = {
  code,
  // Keep the app's MermaidDiagram (theme-aware) over the optional
  // @streamdown/mermaid package so diagrams track light/dark correctly.
  renderers: [
    { language: "mermaid", component: MermaidDiagram },
    { language: "ascii", component: AsciiDiagram },
    { language: "diagram", component: AsciiDiagram },
  ],
} satisfies NonNullable<ComponentProps<typeof Streamdown>["plugins"]>;

type FarmStreamdownProps = ComponentProps<typeof Streamdown> & {
  /** Document path relative to the workspace root — used to resolve images. */
  docPath?: string;
};

/** Drop-in Streamdown with highlighting, mermaid, ASCII diagrams, and assets. */
export function FarmStreamdown({
  className,
  plugins,
  docPath,
  children,
  components,
  lineNumbers = false,
  ...props
}: FarmStreamdownProps) {
  const body = typeof children === "string" ? promoteAsciiFences(children) : children;

  return (
    <Streamdown
      className={cn("farm-streamdown", className)}
      lineNumbers={lineNumbers}
      plugins={{
        ...streamdownPlugins,
        ...plugins,
        renderers: [
          ...streamdownPlugins.renderers,
          ...(plugins?.renderers ?? []),
        ],
        code: plugins?.code ?? streamdownPlugins.code,
      }}
      components={{
        ...components,
        img: (imgProps) => (
          <WorkspaceMarkdownImage {...imgProps} docPath={docPath} />
        ),
      }}
      {...props}
    >
      {body}
    </Streamdown>
  );
}
