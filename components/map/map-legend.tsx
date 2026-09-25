"use client";

import Link from "next/link";
import { heatLegendGradient } from "@/lib/heat/scale";
import { SCORE_COPY } from "@/lib/copy/scores";

// The /world Legend / Help: what every mark on the map means, in one compact list. Wording for territory types matches
// the territory legend and the methodology page; confidence uses the canonical score wording.

const ROWS: { term: string; text: string; swatch?: React.ReactNode }[] = [
  { term: "Heatmap", text: "Blue = lower observed conflict intensity; yellow / orange = elevated; red / deep red = severe. Observed, not a forecast." },
  { term: "Report markers", text: "The number is how many unique published reports the marker represents (duplicates and syndicated copies count once)." },
  { term: "Territorial control", text: "Reported / de-facto control by an actor. Not legal sovereignty." },
  { term: "Contested", text: "Control is disputed or uncertain." },
  { term: "Influence", text: "Meaningful influence, but not necessarily control." },
  { term: "Presence", text: "The actor operates in the area." },
  { term: "Confidence", text: SCORE_COPY.confidence.question },
];

export function MapLegendContent() {
  return (
    <div data-testid="map-legend-content">
      <div className="mb-3 h-1.5 w-full rounded-full" style={{ backgroundImage: heatLegendGradient() }} aria-hidden />
      <dl className="space-y-2">
        {ROWS.map((r) => (
          <div key={r.term}>
            <dt className="text-[11px] font-semibold uppercase tracking-wide text-ink">{r.term}</dt>
            <dd className="text-xs leading-snug text-ink-dim">{r.text}</dd>
          </div>
        ))}
      </dl>
      <Link href="/methodology" className="mt-3 inline-block text-xs text-accent hover:underline">
        How Vigil works (methodology)
      </Link>
    </div>
  );
}
