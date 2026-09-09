import { useEffect, useState, type ComponentProps } from "react";
import { BrainIcon, ChevronDownIcon } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { FarmStreamdown } from "@/lib/streamdown";
import { cn } from "@/lib/utils";

export function Reasoning({ streaming = false, className, ...props }: ComponentProps<typeof Collapsible> & { streaming?: boolean }) {
  const [open, setOpen] = useState(streaming);
  useEffect(() => { if (streaming) setOpen(true); }, [streaming]);
  return <Collapsible open={open} onOpenChange={setOpen} className={cn("not-prose w-full", className)} {...props} />;
}

export function ReasoningTrigger({ streaming = false, ...props }: ComponentProps<typeof CollapsibleTrigger> & { streaming?: boolean }) {
  return <CollapsibleTrigger className="group flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground" {...props}><BrainIcon className={cn("size-3.5", streaming && "animate-pulse")} /><span>{streaming ? "Thinking" : "Reasoning"}</span><ChevronDownIcon className="size-3.5 transition-transform group-data-[state=open]:rotate-180" /></CollapsibleTrigger>;
}

export function ReasoningContent({ children, className, ...props }: Omit<ComponentProps<typeof CollapsibleContent>, "children"> & { children: string }) {
  return <CollapsibleContent className={cn("mt-2 border-l pl-4 text-sm text-muted-foreground", className)} {...props}><FarmStreamdown>{children}</FarmStreamdown></CollapsibleContent>;
}
