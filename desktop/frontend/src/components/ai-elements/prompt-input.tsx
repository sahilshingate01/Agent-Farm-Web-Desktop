import type { FormHTMLAttributes, TextareaHTMLAttributes } from "react";
import { ArrowUpIcon, SquareIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function PromptInput({ className, ...props }: FormHTMLAttributes<HTMLFormElement>) {
  return <form className={cn("prompt-input rounded-xl border bg-card p-3 shadow-md shadow-black/10 transition-[border-color,box-shadow] focus-within:border-ring/70 focus-within:ring-2 focus-within:ring-ring/10", className)} {...props} />;
}

export function PromptInputTextarea({ className, onKeyDown, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn("max-h-40 min-h-16 w-full resize-none bg-transparent px-2 py-1 type-body text-foreground outline-none placeholder:text-muted-foreground", className)}
      onKeyDown={(event) => {
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          event.currentTarget.form?.requestSubmit();
        }
        onKeyDown?.(event);
      }}
      {...props}
    />
  );
}

export function PromptInputFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex min-h-9 items-center justify-between gap-2 px-1", className)} {...props} />;
}

export function PromptInputSubmit({ status = "ready", ...props }: React.ComponentProps<typeof Button> & { status?: "ready" | "streaming" }) {
  return (
    <Button aria-label={status === "streaming" ? "Stop response" : "Send message"} size="icon" variant="secondary" className="rounded-full" type="submit" {...props}>
      {status === "streaming" ? <SquareIcon data-icon="inline-start" /> : <ArrowUpIcon data-icon="inline-start" />}
    </Button>
  );
}
