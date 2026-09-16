import { cn } from "@/lib/utils";

export function BrandMark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 select-none", className)}>
      <svg viewBox="0 0 32 32" className="h-6 w-6" aria-hidden>
        <circle cx="16" cy="16" r="14" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="1.5" />
        <circle cx="16" cy="16" r="9" fill="none" stroke="currentColor" strokeOpacity="0.5" strokeWidth="1.5" />
        <circle cx="16" cy="16" r="3.2" fill="var(--color-accent)" />
        <path d="M16 2 L16 6 M16 26 L16 30 M2 16 L6 16 M26 16 L30 16" stroke="currentColor" strokeOpacity="0.35" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
      <span className="text-[15px] font-semibold tracking-tight text-ink">Vigil</span>
    </span>
  );
}
