import * as React from "react";
import { cn } from "@/lib/utils";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea ref={ref} className={cn("min-h-20 w-full resize-y rounded-md border border-input bg-background px-3 py-2.5 type-body text-foreground shadow-xs placeholder:text-muted-foreground transition-[border-color,box-shadow] focus:border-ring focus:ring-2 focus:ring-ring/20 disabled:opacity-50", className)} {...props} />
  ),
);
Textarea.displayName = "Textarea";
