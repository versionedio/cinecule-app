import * as React from "react";
import { AlertCircle, CheckCircle2, Info } from "lucide-react";
import { cn } from "@/lib/utils";

const ICONS = { success: CheckCircle2, error: AlertCircle, info: Info } as const;
const STYLES = {
  success: "border-success/30 bg-success/10 text-success",
  error: "border-destructive/30 bg-destructive/10 text-destructive",
  info: "border-info/30 bg-info/10 text-info"
} as const;

export function Alert({
  severity = "info",
  title,
  className,
  children
}: {
  severity?: keyof typeof ICONS;
  title?: string;
  className?: string;
  children?: React.ReactNode;
}) {
  const Icon = ICONS[severity];
  return (
    <div className={cn("flex items-start gap-2.5 rounded-lg border px-3.5 py-3 text-sm", STYLES[severity], className)}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="text-foreground/90">
        {title && <p className="mb-0.5 font-medium text-foreground">{title}</p>}
        {children}
      </div>
    </div>
  );
}
