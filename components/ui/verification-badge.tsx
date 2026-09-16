import { BadgeCheck, Radio, Users, Landmark, HelpCircle, AlertCircle } from "lucide-react";
import type { VerificationStatus } from "@/lib/types";
import { VERIFICATION_LABEL } from "@/lib/utils/severity";
import { cn } from "@/lib/utils";

const ICON: Record<VerificationStatus, React.ComponentType<{ className?: string }>> = {
  unverified: HelpCircle,
  reported: Radio,
  multiple_sources: Users,
  confirmed: BadgeCheck,
  official_claim: Landmark,
};

export function VerificationBadge({
  status,
  disputed,
  className,
}: {
  status: VerificationStatus;
  disputed?: boolean;
  className?: string;
}) {
  const Icon = disputed ? AlertCircle : ICON[status];
  const label = disputed ? "Disputed" : VERIFICATION_LABEL[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-border-strong px-2.5 py-1 text-[11px] font-medium text-ink-dim",
        disputed && "border-high/40 text-high",
        className,
      )}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {label}
    </span>
  );
}
