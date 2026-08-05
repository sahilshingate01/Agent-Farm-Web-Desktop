import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex shrink-0 select-none items-center justify-center gap-2 font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/60 active:translate-y-px disabled:pointer-events-none disabled:opacity-45 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary font-secondary uppercase text-primary-foreground hover:opacity-90",
        secondary: "bg-secondary font-secondary uppercase text-secondary-foreground hover:bg-accent",
        outline: "border bg-background font-secondary uppercase text-foreground hover:bg-accent hover:text-accent-foreground",
        ghost: "text-foreground hover:bg-accent hover:text-accent-foreground",
        destructive: "bg-destructive font-secondary uppercase text-destructive-foreground hover:opacity-90",
      },
      size: {
        xs: "h-6 gap-1 rounded-[min(var(--radius-md),6px)] px-2 text-[0.714rem] [&_svg]:size-3",
        sm: "h-7 gap-1.5 rounded-[min(var(--radius-md),8px)] px-2.5 text-xs [&_svg]:size-3.5",
        default: "h-8 gap-1.5 rounded-[min(var(--radius-md),9px)] px-3 text-sm [&_svg]:size-4",
        lg: "h-9 rounded-[min(var(--radius-md),10px)] px-4 text-sm [&_svg]:size-4",
        "icon-xs": "size-6 rounded-[min(var(--radius-md),6px)] [&_svg]:size-3",
        "icon-sm": "size-7 rounded-[min(var(--radius-md),8px)] [&_svg]:size-3.5",
        icon: "size-8 rounded-[min(var(--radius-md),9px)] [&_svg]:size-4",
        "icon-lg": "size-9 rounded-[min(var(--radius-md),10px)] [&_svg]:size-4",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  ),
);
Button.displayName = "Button";

export { buttonVariants };
