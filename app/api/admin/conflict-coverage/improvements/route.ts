import { NextResponse } from "next/server";
import baseline from "@/data/coverage-baseline.json";
import { listCoverage } from "@/lib/db/repositories/coverage";
import { compareCoverage, stillUndercovered, type CoverageSnapshotRow } from "@/lib/registry/coverage-diff";
import type { CoverageHealth } from "@/lib/registry/coverage";

// Coverage improvement report: current coverage against the pre-expansion
// baseline (data/coverage-baseline.json) — which conflicts improved, and which
// active conflicts are still under-covered. Admin-only; not a public ranking.
export async function GET() {
  const { rows, summary } = await listCoverage();
  const current: CoverageSnapshotRow[] = rows.map((r) => ({
    slug: r.conflict.slug,
    status: r.status,
    severity: r.conflict.severity,
    intensity: r.conflict.intensity,
    health: r.health,
    enabledSources: r.enabledSources,
    dedicatedSources: r.dedicatedSources,
    specialistSources: r.specialistSources,
    generalSources: r.generalSources,
    aggregatorSources: r.aggregatorSources,
    independentSources: r.independentSources,
  }));
  const before: CoverageSnapshotRow[] = (baseline.conflicts as unknown as (Omit<CoverageSnapshotRow, "health"> & { health: string })[]).map((c) => ({ ...c, health: c.health as CoverageHealth }));
  const changes = compareCoverage(before, current);
  const nameBySlug = new Map(rows.map((r) => [r.conflict.slug, r.conflict.name]));
  const withName = <T extends { slug: string }>(list: T[]) => list.map((x) => ({ ...x, name: nameBySlug.get(x.slug) ?? x.slug }));
  return NextResponse.json({
    baseline: { label: baseline.label, capturedAt: baseline.capturedAt, summary: baseline.summary },
    current: summary,
    improved: withName(changes.filter((c) => c.movement === "improved")),
    unchanged: withName(changes.filter((c) => c.movement === "unchanged")),
    regressed: withName(changes.filter((c) => c.movement === "regressed")),
    stillUndercovered: withName(stillUndercovered(current)),
  });
}
