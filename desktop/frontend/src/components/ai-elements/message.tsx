import type { ComponentProps, HTMLAttributes } from "react";
import { Button } from "@/components/ui/button";
import { FarmStreamdown } from "@/lib/streamdown";
import { cn } from "@/lib/utils";

export function Message({ from, className, ...props }: HTMLAttributes<HTMLDivElement> & { from: "user" | "assistant" | "system" }) {
  return <article className={cn("group flex w-full flex-col gap-2", from === "user" ? "is-user ml-auto items-end" : "is-assistant items-start", className)} {...props} />;
}

export function MessageContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("min-w-0 max-w-full type-body group-[.is-assistant]:w-full group-[.is-user]:max-w-[78%] group-[.is-user]:rounded-lg group-[.is-user]:bg-secondary group-[.is-user]:px-4 group-[.is-user]:py-2.5 group-[.is-user]:text-secondary-foreground", className)} {...props} />;
}

export function MessageResponse({ className, ...props }: ComponentProps<typeof FarmStreamdown>) {
  return <FarmStreamdown className={cn("size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0", className)} {...props} />;
}

export function MessageActions({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex items-center gap-0.5 text-muted-foreground", className)} {...props} />;
}

export function MessageAction({ label, ...props }: ComponentProps<typeof Button> & { label: string }) {
  return <Button type="button" variant="ghost" size="icon-sm" aria-label={label} title={label} {...props} />;
}

export function MessageMeta({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("text-sm leading-5 text-muted-foreground", className)} {...props} />;
}
