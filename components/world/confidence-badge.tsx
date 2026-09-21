import { cn } from "@/lib/utils";

export const CONFIDENCE_TOOLTIP = "Confidence reflects evidence/corroboration. It does not represent severity.";
const LABEL = { high: "High", medium: "Medium", low: "Low" } as const;
const TONE = { high: "text-stable", medium: "text-accent", low: "text-ink-faint" } as const;

/** Confidence (evidence / corroboration) - deliberately styled apart from severity, always with the tooltip. */
export function ConfidenceBadge({ level, score, className }: { level: "high" | "medium" | "low"; score?: number | null; className?: string }) {
  return (
    <span title={CONFIDENCE_TOOLTIP} data-testid="confidence-badge" className={cn("inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide", TONE[level], className)}>
      <span className="text-ink-faint">Conf.</span> {LABEL[level]}
      {score != null && <span className="text-ink-faint normal-case">{Math.round(score)}%</span>}
    </span>
  );
}
