import { cn } from "@/lib/utils";

export function LiveIndicator({ label = "LIVE", className }: { label?: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-stable/30 bg-stable-dim px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-stable",
        className,
      )}
    >
      <span className="relative flex h-1.5 w-1.5">
        <span className="absolute inline-flex h-full w-full animate-pulse-soft rounded-full bg-stable" />
      </span>
      {label}
    </span>
  );
}
