import type { HTMLAttributes, ReactNode } from "react";
import { ListRestartIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function Queue({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-lg border bg-muted/35", className)} {...props} />;
}

export function QueueHeader({ count }: { count: number }) {
  return <div className="flex items-center gap-2 border-b px-3 py-2 text-xs font-medium"><ListRestartIcon className="size-3.5 text-muted-foreground" />Queued messages<span className="ml-auto font-mono text-muted-foreground">{count}</span></div>;
}

export function QueueItem({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  return <div className="flex items-center gap-2 border-b px-3 py-2 text-xs last:border-b-0"><span className="min-w-0 flex-1 truncate text-muted-foreground">{children}</span>{actions}</div>;
}
