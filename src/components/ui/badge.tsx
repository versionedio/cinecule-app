import * as React from "react";
import { cn } from "@/lib/utils";

export function Badge({
  className,
  color,
  children,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { color?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-[3px] border px-2.5 py-0.5 text-[11px] tracking-wide",
        !color && "border-border bg-surface-raised text-muted",
        className
      )}
      style={
        color
          ? { color, borderColor: `${color}55`, backgroundColor: `${color}22` }
          : undefined
      }
      {...props}
    >
      {children}
    </span>
  );
}
