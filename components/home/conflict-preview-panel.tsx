"use client";

import Link from "next/link";
import { ArrowRight, X } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { GlassCard } from "@/components/ui/card";
import { SeverityBadge } from "@/components/ui/severity-badge";
import { buttonVariants } from "@/components/ui/button";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { exposureLabel } from "@/lib/utils/exposure";
import { cn } from "@/lib/utils";
import { RelativeTime } from "@/components/ui/relative-time";
import type { Conflict } from "@/lib/types";
import { computeImpact, DIMENSION_LABEL } from "@/lib/data/impact";
import { getCountryByCode } from "@/lib/reference/countries";

function PreviewContent({ conflict, impactScore }: { conflict: Conflict; impactScore: number }) {
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-lg font-semibold text-ink">{conflict.name}</h3>
      </div>
      <SeverityBadge severity={conflict.severity} className="mt-2" />

      <div className="mt-4 grid grid-cols-2 gap-4">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wide text-ink-faint">Intensity</p>
          <p className="mt-0.5 text-2xl font-semibold tabular-nums text-ink">
            {conflict.intensity}
            <span className="text-sm font-medium text-ink-faint"> / 100</span>
          </p>
        </div>
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wide text-ink-faint">Impact on you</p>
          <p className="mt-0.5 text-2xl font-semibold tabular-nums text-accent">
            {impactScore}
            <span className="text-sm font-medium text-ink-faint"> / 100</span>
          </p>
        </div>
      </div>

      {conflict.summary && <p className="mt-4 text-[13px] leading-relaxed text-ink-dim">{conflict.summary}</p>}

      <p className="mt-3 text-xs text-ink-faint" data-testid="preview-last-event">
        {conflict.lastEventAt ? <RelativeTime iso={conflict.lastEventAt} prefix="Last event " /> : "No published events yet"}
      </p>

      <Link
        href={`/conflict/${conflict.slug}`}
        className={cn(buttonVariants({ variant: "primary", size: "md" }), "mt-4 w-full")}
      >
        View Conflict
        <ArrowRight className="h-4 w-4" />
      </Link>
    </div>
  );
}

export function ConflictPreviewPanel({
  conflict,
  baseCountryCode,
  onClose,
}: {
  conflict: Conflict | null;
  baseCountryCode: string;
  onClose: () => void;
}) {
  const country = getCountryByCode(baseCountryCode);
  const impact = conflict && country ? computeImpact(country, conflict) : null;

  return (
    <>
      {/* Desktop floating panel */}
      <div className="pointer-events-none fixed inset-x-0 bottom-24 z-30 hidden justify-center sm:flex">
        <AnimatePresence>
          {conflict && impact && (
            <motion.div
              className="pointer-events-auto"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 12 }}
              transition={{ duration: 0.2 }}
            >
              <GlassCard className="relative w-[360px] p-5">
                <button
                  onClick={onClose}
                  aria-label="Close preview"
                  className="absolute right-3 top-3 rounded-md p-1 text-ink-faint hover:bg-white/5 hover:text-ink"
                >
                  <X className="h-4 w-4" />
                </button>
                <PreviewContent conflict={conflict} impactScore={impact.score} />
              </GlassCard>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Mobile bottom sheet */}
      <BottomSheet open={!!conflict} onClose={onClose} label={conflict?.name}>
        {conflict && impact && (
          <>
            <PreviewContent conflict={conflict} impactScore={impact.score} />
            <div className="mt-4 space-y-2 border-t border-border pt-4">
              {impact.components.slice(0, 3).map((c) => (
                <div key={c.dimension} className="flex items-center justify-between text-sm">
                  <span className="text-ink-dim">{DIMENSION_LABEL[c.dimension]}</span>
                  <span className="font-medium text-ink">{exposureLabel(c.value)}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </BottomSheet>
    </>
  );
}
