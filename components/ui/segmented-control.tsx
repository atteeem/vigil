"use client";

import { cn } from "@/lib/utils";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  className,
  size = "md",
  "aria-label": ariaLabel,
}: {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
  /** "sm" is the compact variant used inside dense control bars. */
  size?: "sm" | "md";
  "aria-label"?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-border bg-surface/70 p-1 backdrop-blur",
        className,
      )}
    >
      {options.map((opt) => (
        <button
          key={opt.value}
          role="radio"
          aria-checked={value === opt.value}
          onClick={() => onChange(opt.value)}
          className={cn(
            "rounded-full text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
            size === "sm" ? "px-2 py-1" : "px-3 py-1.5",
            value === opt.value
              ? "bg-ink text-bg"
              : "text-ink-dim hover:text-ink",
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
