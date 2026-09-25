"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { HelpCircle } from "lucide-react";
import { SOURCE_CLASS_COPY } from "@/lib/copy/scores";
import { cn } from "@/lib/utils";

/** The one explanation of source labels, used next to evidence lists, in Settings → Sources and on /methodology. */
export function SourceTrustList({ className }: { className?: string }) {
  return (
    <dl className={cn("space-y-2.5", className)} data-testid="source-trust-help">
      {SOURCE_CLASS_COPY.map((c) => (
        <div key={c.key}>
          <dt className="text-xs font-semibold text-ink">{c.label}</dt>
          <dd className="text-xs leading-snug text-ink-dim">{c.text}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Compact disclosure: "What do these labels mean?" */
export function SourceTrustHelp({ className, label = "What do source labels mean?" }: { className?: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className={className}>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-controls={id} className="inline-flex items-center gap-1 text-[11px] font-medium text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" data-testid="source-trust-toggle">
        <HelpCircle className="h-3.5 w-3.5" aria-hidden /> {label}
      </button>
      {open && (
        <div id={id} className="mt-2 rounded-xl border border-border bg-surface/80 p-3">
          <SourceTrustList />
          <Link href="/methodology#sources" className="mt-2 inline-block text-[11px] text-accent hover:underline">
            More in the methodology
          </Link>
        </div>
      )}
    </div>
  );
}
