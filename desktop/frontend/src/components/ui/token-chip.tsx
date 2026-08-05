import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export const TokenChip = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { selected?: boolean }
>(function TokenChip(
  { className, selected = false, type = "button", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        "inline-flex min-h-7 items-center rounded-md border px-2 py-1 text-xs font-medium leading-tight transition-colors",
        selected
          ? "border-primary bg-primary text-primary-foreground"
          : "border-input bg-background text-foreground hover:bg-accent",
        className,
      )}
      {...props}
    />
  );
});
