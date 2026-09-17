import { FileEdit, Globe2, EyeOff } from "lucide-react";
import type { EventStatus } from "@/lib/types/db";
import { cn } from "@/lib/utils";

const CONFIG: Record<EventStatus, { label: string; icon: React.ComponentType<{ className?: string }>; className: string }> = {
  draft: { label: "Draft", icon: FileEdit, className: "bg-white/5 text-ink-faint" },
  published: { label: "Published", icon: Globe2, className: "bg-stable-dim text-stable" },
  unpublished: { label: "Unpublished", icon: EyeOff, className: "bg-elevated-dim text-elevated" },
};

export function EventStatusBadge({ status, className }: { status: EventStatus; className?: string }) {
  const { label, icon: Icon, className: colorClassName } = CONFIG[status];
  return (
    <span
      data-testid="event-status-badge"
      data-status={status}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide",
        colorClassName,
        className,
      )}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {label}
    </span>
  );
}
