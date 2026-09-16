"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { MOCK_COUNTRIES } from "@/lib/data/mock-countries";
import { useAppStore } from "@/hooks/use-app-store";
import { cn } from "@/lib/utils";

export function CountrySelector({ className }: { className?: string }) {
  const baseCountryCode = useAppStore((s) => s.baseCountryCode);
  const setBaseCountryCode = useAppStore((s) => s.setBaseCountryCode);
  const [open, setOpen] = useState(false);
  const current = MOCK_COUNTRIES.find((c) => c.code === baseCountryCode);

  return (
    <div className={cn("relative", className)}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-full border border-border-strong bg-white/[0.03] px-2.5 py-1 text-xs font-medium text-ink hover:bg-white/[0.06]"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span aria-hidden>{current?.flag}</span>
        {current?.name ?? "Select country"}
        <ChevronDown className="h-3.5 w-3.5 text-ink-faint" />
      </button>
      {open && (
        <ul
          role="listbox"
          className="glass-card absolute left-0 top-9 z-30 max-h-64 w-56 overflow-y-auto rounded-xl border border-border p-1"
        >
          {MOCK_COUNTRIES.map((c) => (
            <li key={c.code}>
              <button
                role="option"
                aria-selected={c.code === baseCountryCode}
                onClick={() => {
                  setBaseCountryCode(c.code);
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs",
                  c.code === baseCountryCode ? "bg-white/10 text-ink" : "text-ink-dim hover:bg-white/5",
                )}
              >
                <span aria-hidden>{c.flag}</span>
                {c.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
