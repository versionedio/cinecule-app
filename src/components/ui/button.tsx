import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[4px] font-display text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 disabled:pointer-events-none disabled:opacity-45",
  {
    variants: {
      variant: {
        // Stroke, not fill — the Classical direction treats the accent as a
        // border/text color, never a solid background.
        default: "border border-primary text-primary-text hover:bg-primary/10 active:bg-primary/20",
        outline: "border border-border bg-transparent text-foreground hover:bg-surface-raised",
        ghost: "text-primary-text px-2 hover:bg-primary/10 active:bg-primary/18",
        destructive: "border border-destructive/40 text-destructive-text hover:bg-destructive/10",
        link: "text-primary-text underline-offset-4 hover:underline"
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-8 rounded-[3px] px-3 text-xs",
        lg: "h-11 rounded-[4px] px-6"
      }
    },
    defaultVariants: { variant: "default", size: "default" }
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
