import * as React from "react";
import { cn } from "@/lib/utils";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input ref={ref} className={cn("h-8 w-full rounded-md border border-input bg-background px-3 type-body text-foreground shadow-xs placeholder:text-muted-foreground transition-[border-color,box-shadow] focus:border-ring focus:ring-2 focus:ring-ring/20 disabled:opacity-50", className)} {...props} />
  ),
);
Input.displayName = "Input";
