import { isLiveStatus } from "@/lib/registry/status";
import type { CoverageHealth } from "@/lib/registry/coverage";

// Before/after coverage: which conflicts improved after sources were added, and
// which active conflicts are still under-covered. Compares STRUCTURE (how many
// sources, which tiers, diversity) as well as health, because health also
// depends on live ingestion. Never derived from article volume.

export interface CoverageSnapshotRow {
  slug: string;
  status: string;
  severity: string;
  intensity: number;
  health: CoverageHealth;
  enabledSources: number;
  dedicatedSources: number;
  specialistSources: number;
  generalSources: number;
  aggregatorSources: number;
  independentSources: number;
}

const HEALTH_RANK: Record<CoverageHealth, number> = { inactive: -1, no_source: 0, stale: 1, weak: 2, healthy: 3 };
const SEVERITY_RANK: Record<string, number> = { stable: 0, guarded: 1, elevated: 2, high: 3, severe: 4, extreme: 5 };

export type Movement = "improved" | "unchanged" | "regressed";

export interface CoverageChange {
  slug: string;
  severity: string;
  intensity: number;
  movement: Movement;
  before: Pick<CoverageSnapshotRow, "health" | "enabledSources" | "independentSources" | "specialistSources" | "dedicatedSources">;
  after: Pick<CoverageSnapshotRow, "health" | "enabledSources" | "independentSources" | "specialistSources" | "dedicatedSources">;
  reasons: string[];
}

const pick = (r: CoverageSnapshotRow) => ({
  health: r.health,
  enabledSources: r.enabledSources,
  independentSources: r.independentSources,
  specialistSources: r.specialistSources,
  dedicatedSources: r.dedicatedSources,
});

/** Per-conflict movement. A conflict improved when its independent-source
 * count, its grounded (dedicated/specialist/local) source count or its health
 * rank went up — raw source counts alone (e.g. more aggregators) do not count. */
export function compareCoverage(before: CoverageSnapshotRow[], after: CoverageSnapshotRow[]): CoverageChange[] {
  const beforeBySlug = new Map(before.map((r) => [r.slug, r]));
  const changes: CoverageChange[] = [];
  for (const a of after) {
    const b = beforeBySlug.get(a.slug);
    if (!b) continue;
    const reasons: string[] = [];
    let up = 0;
    let down = 0;
    if (a.independentSources > b.independentSources) (up++, reasons.push(`independent sources ${b.independentSources} → ${a.independentSources}`));
    if (a.independentSources < b.independentSources) down++;
    const groundedBefore = b.specialistSources + b.dedicatedSources;
    const groundedAfter = a.specialistSources + a.dedicatedSources;
    if (groundedAfter > groundedBefore) (up++, reasons.push(`dedicated/local/specialist sources ${groundedBefore} → ${groundedAfter}`));
    if (groundedAfter < groundedBefore) down++;
    if (HEALTH_RANK[a.health] > HEALTH_RANK[b.health]) (up++, reasons.push(`health ${b.health} → ${a.health}`));
    if (HEALTH_RANK[a.health] < HEALTH_RANK[b.health] && HEALTH_RANK[b.health] >= 0) down++;
    changes.push({
      slug: a.slug,
      severity: a.severity,
      intensity: a.intensity,
      movement: up > 0 && down === 0 ? "improved" : down > 0 && up === 0 ? "regressed" : up > 0 ? "improved" : "unchanged",
      before: pick(b),
      after: pick(a),
      reasons,
    });
  }
  return changes.sort((x, y) => (SEVERITY_RANK[y.severity] ?? 0) - (SEVERITY_RANK[x.severity] ?? 0) || y.intensity - x.intensity);
}

export interface UndercoveredRow extends CoverageSnapshotRow {
  problems: string[];
}

/** Live (active/reduced) conflicts that still lack solid coverage, worst-first
 * (highest severity, then intensity): no source, stale, weak, or no
 * dedicated/local/specialist source. */
export function stillUndercovered(rows: CoverageSnapshotRow[]): UndercoveredRow[] {
  const out: UndercoveredRow[] = [];
  for (const r of rows) {
    if (!isLiveStatus(r.status)) continue;
    const problems: string[] = [];
    if (r.health === "no_source") problems.push("no source");
    else if (r.health === "stale") problems.push("stale");
    else if (r.health === "weak") problems.push("weak diversity");
    if (r.enabledSources > 0 && r.specialistSources + r.dedicatedSources === 0) problems.push("no dedicated/local/specialist source");
    if (problems.length > 0) out.push({ ...r, problems });
  }
  return out.sort((x, y) => (SEVERITY_RANK[y.severity] ?? 0) - (SEVERITY_RANK[x.severity] ?? 0) || y.intensity - x.intensity);
}
