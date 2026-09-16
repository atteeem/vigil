"use client";

import { cn } from "@/lib/utils";

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  className,
}: {
  tabs: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      className={cn(
        "no-scrollbar flex items-center gap-1 overflow-x-auto border-b border-border",
        className,
      )}
    >
      {tabs.map((t) => (
        <button
          key={t.value}
          role="tab"
          aria-selected={value === t.value}
          onClick={() => onChange(t.value)}
          className={cn(
            "shrink-0 border-b-2 px-3.5 py-2.5 text-sm font-medium transition-colors",
            value === t.value
              ? "border-accent text-ink"
              : "border-transparent text-ink-faint hover:text-ink-dim",
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
