import { AlertTriangle, ShieldAlert, Flame, TrendingUp, CircleDot, Eye } from "lucide-react";
import type { Severity } from "@/lib/types";
import { SEVERITY_LABEL, SEVERITY_BG_DIM_CLASS, SEVERITY_TEXT_CLASS } from "@/lib/utils/severity";
import { cn } from "@/lib/utils";

const ICON: Record<Severity, React.ComponentType<{ className?: string }>> = {
  stable: CircleDot,
  guarded: Eye,
  elevated: TrendingUp,
  high: AlertTriangle,
  severe: Flame,
  extreme: ShieldAlert,
};

export function SeverityBadge({
  severity,
  size = "md",
  className,
}: {
  severity: Severity;
  size?: "sm" | "md";
  className?: string;
}) {
  const Icon = ICON[severity];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full font-semibold uppercase tracking-wide",
        SEVERITY_BG_DIM_CLASS[severity],
        SEVERITY_TEXT_CLASS[severity],
        size === "sm" ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-1 text-[11px]",
        className,
      )}
    >
      <Icon className={size === "sm" ? "h-3 w-3" : "h-3.5 w-3.5"} aria-hidden />
      {SEVERITY_LABEL[severity]}
    </span>
  );
}

export function SeverityDot({ severity, className }: { severity: Severity; className?: string }) {
  return (
    <span
      className={cn("inline-block h-2 w-2 rounded-full", className)}
      style={{ backgroundColor: `var(--color-${severity})` }}
      aria-hidden
    />
  );
}
