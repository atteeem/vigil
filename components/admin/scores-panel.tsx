"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Gauge, ShieldCheck, Globe2 } from "lucide-react";

// Central Conflict Scoring Engine v1 §8 — "Show the three scores +
// reasons on admin conflict/event views. Allow impact preview for a
// selected country." One shared component so this UI exists exactly once,
// used by both app/admin/conflicts/page.tsx and app/admin/events/[id]/page.tsx.

interface ScoreResult {
  reasons: string[];
}
interface SeverityResult extends ScoreResult {
  severityScore: number;
  severityLabel: string;
}
interface ImpactResult extends ScoreResult {
  impactScore: number;
}
interface ConfidenceResult extends ScoreResult {
  confidenceScore: number;
}
interface EntityScores {
  severity: SeverityResult;
  confidence: ConfidenceResult;
  impact: ImpactResult | null;
}

// The 28 countries this app has coordinates for (lib/data/mock-countries.ts)
// — the only real country dataset with lat/lng in the codebase today, so
// it's what the preview selector offers.
const PREVIEW_COUNTRIES = [
  { code: "FI", name: "Finland" },
  { code: "UA", name: "Ukraine" },
  { code: "RU", name: "Russia" },
  { code: "PL", name: "Poland" },
  { code: "DE", name: "Germany" },
  { code: "GB", name: "United Kingdom" },
  { code: "US", name: "United States" },
  { code: "IL", name: "Israel" },
  { code: "PS", name: "Palestinian Territories" },
  { code: "LB", name: "Lebanon" },
  { code: "SY", name: "Syria" },
  { code: "IR", name: "Iran" },
  { code: "SA", name: "Saudi Arabia" },
  { code: "YE", name: "Yemen" },
  { code: "SD", name: "Sudan" },
  { code: "CD", name: "DR Congo" },
  { code: "SO", name: "Somalia" },
  { code: "ML", name: "Mali" },
  { code: "NG", name: "Nigeria" },
  { code: "EG", name: "Egypt" },
  { code: "MM", name: "Myanmar" },
  { code: "IN", name: "India" },
  { code: "PK", name: "Pakistan" },
  { code: "KR", name: "South Korea" },
  { code: "KP", name: "North Korea" },
  { code: "TW", name: "Taiwan" },
  { code: "CN", name: "China" },
  { code: "JP", name: "Japan" },
  { code: "TR", name: "Turkey" },
];

function ScoreRow({ icon: Icon, label, value, reasons }: { icon: typeof Gauge; label: string; value: number; reasons: string[] }) {
  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-xs font-medium text-ink-dim">
          <Icon className="h-3.5 w-3.5" />
          {label}
        </span>
        <span className="text-sm font-semibold text-ink" data-testid={`${label.toLowerCase()}-score-value`}>
          {value}
        </span>
      </div>
      <ul className="mt-1 space-y-0.5 pl-5 text-xs text-ink-faint">
        {reasons.map((r, i) => (
          <li key={i} className="list-disc">
            {r}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ScoresPanel({ kind, entityId }: { kind: "conflicts" | "events"; entityId: string }) {
  const [previewCountry, setPreviewCountry] = useState("");

  const { data, isLoading } = useQuery<EntityScores>({
    queryKey: ["admin", kind, entityId, "score", previewCountry],
    queryFn: async () => {
      const url = `/api/admin/${kind}/${entityId}/score${previewCountry ? `?countryCode=${previewCountry}` : ""}`;
      return (await fetch(url)).json();
    },
  });

  if (isLoading || !data) return <p className="text-xs text-ink-faint">Loading scores…</p>;

  return (
    <div className="space-y-3" data-testid="scores-panel">
      <ScoreRow icon={Gauge} label="Severity" value={data.severity.severityScore} reasons={data.severity.reasons} />
      <ScoreRow icon={ShieldCheck} label="Confidence" value={data.confidence.confidenceScore} reasons={data.confidence.reasons} />

      <div>
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-xs font-medium text-ink-dim">
            <Globe2 className="h-3.5 w-3.5" />
            Impact preview
          </span>
          <select
            value={previewCountry}
            onChange={(e) => setPreviewCountry(e.target.value)}
            className="rounded-lg border border-border bg-surface px-2 py-1 text-xs text-ink"
            data-testid="impact-preview-country"
          >
            <option value="">Select a country…</option>
            {PREVIEW_COUNTRIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        {data.impact ? (
          <div className="mt-1">
            <div className="text-right text-sm font-semibold text-ink" data-testid="impact-score-value">
              {data.impact.impactScore}
            </div>
            <ul className="mt-1 space-y-0.5 pl-5 text-xs text-ink-faint">
              {data.impact.reasons.map((r, i) => (
                <li key={i} className="list-disc">
                  {r}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="mt-1 text-xs text-ink-faint">Select a country to preview its impact score.</p>
        )}
      </div>
    </div>
  );
}
