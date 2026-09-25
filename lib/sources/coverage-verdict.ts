import { sourceTrust } from "@/lib/sources/trust";

// One deterministic source-coverage verdict for any subject (a country, a conflict). It answers "is Vigil likely to
// learn about developments here in time, from the sources it actually polls?" — never "is the picture true". The
// number of sources is not a confidence score.
//
//   STALE   - no relevant source (the dedicated ones, or the global ones when nothing is dedicated) delivered new
//             items within the freshness window;
//   GOOD    - at least two fresh independent dedicated sources and no recorded coverage gap;
//   LIMITED - anything else (only global outlets, a single dedicated source, a gap).

export interface CoverageSourceInput {
  id: string;
  dedicated: boolean;
  independenceClass?: string | null;
  claimPolicy?: string | null;
  sourceRole?: string | null;
  perspective?: string | null;
  lastSuccessfulIngestion: Date | null;
}

export interface CoverageVerdict {
  state: "GOOD" | "LIMITED" | "STALE";
  reasons: string[];
  dedicated: number;
  global: number;
  official: number;
  independent: number;
  partyAligned: number;
  freshDedicated: number;
  freshGlobal: number;
  lastSuccessfulIngestion: string | null;
}

export function coverageVerdict(subject: string, sources: readonly CoverageSourceInput[], opts: { now: Date; staleHours: number; gaps?: number }): CoverageVerdict {
  const cutoff = opts.now.getTime() - opts.staleHours * 3_600_000;
  const fresh = (s: CoverageSourceInput) => !!s.lastSuccessfulIngestion && s.lastSuccessfulIngestion.getTime() >= cutoff;
  const trust = (s: CoverageSourceInput) => sourceTrust(s).category;
  const dedicated = sources.filter((s) => s.dedicated);
  const global = sources.filter((s) => !s.dedicated);
  const freshDedicated = dedicated.filter(fresh);
  const freshGlobal = global.filter(fresh);
  const freshIndependentDedicated = freshDedicated.filter((s) => ["strong", "perspective"].includes(trust(s)));
  const gaps = opts.gaps ?? 0;
  const reasons: string[] = [];
  let state: CoverageVerdict["state"];
  if ((dedicated.length > 0 && freshDedicated.length === 0 && freshGlobal.length === 0) || (dedicated.length === 0 && freshGlobal.length === 0)) {
    state = "STALE";
    reasons.push(`No relevant source delivered new items in the last ${opts.staleHours} h.`);
  } else if (freshIndependentDedicated.length >= 2 && gaps === 0) {
    state = "GOOD";
    reasons.push(`${freshIndependentDedicated.length} fresh independent sources dedicated to ${subject}.`);
  } else {
    state = "LIMITED";
    if (dedicated.length === 0) reasons.push(`No source is dedicated to ${subject}; coverage relies on global outlets.`);
    else if (freshIndependentDedicated.length < 2) reasons.push(`Fewer than two fresh independent dedicated sources (${freshIndependentDedicated.length}).`);
    if (gaps) reasons.push(`${gaps} recorded coverage gap${gaps === 1 ? "" : "s"}.`);
  }
  const times = sources.map((s) => s.lastSuccessfulIngestion).filter((t): t is Date => !!t).map((t) => t.getTime());
  return {
    state,
    reasons,
    dedicated: dedicated.length,
    global: global.length,
    official: sources.filter((s) => s.sourceRole === "official").length,
    independent: sources.filter((s) => ["strong", "perspective"].includes(trust(s))).length,
    partyAligned: sources.filter((s) => trust(s) === "party_claim").length,
    freshDedicated: freshDedicated.length,
    freshGlobal: freshGlobal.length,
    lastSuccessfulIngestion: times.length ? new Date(Math.max(...times)).toISOString() : null,
  };
}
