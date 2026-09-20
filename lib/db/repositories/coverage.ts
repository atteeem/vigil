import { prisma } from "@/lib/db/client";
import { toConflictDTO } from "@/lib/db/repositories/conflicts";
import { COVERAGE_THRESHOLDS, computeCoverage, summarizeCoverage, classifySource, type CoverageHealth, type CoverageSource, type CoverageSummary, type SourceKind } from "@/lib/registry/coverage";
import { conflictGeographyOf, type ConflictGeography } from "@/lib/registry/geography";
import { normalizeConflictStatus, type RegistryStatus } from "@/lib/registry/status";
import { sourceTierOf, type SourceTier, type TierCounts } from "@/lib/registry/source-tiers";
import type { ConflictDTO } from "@/lib/types/db";

// Conflict coverage dashboard data: per conflict, which sources are relevant
// (explicit links, country match, or having actually contributed events), when
// the last event/ingestion happened, and the derived health. Admin-only.

export interface CoverageSourceDTO {
  id: string;
  name: string;
  kind: SourceKind;
  tier: SourceTier;
  link: string;
  enabled: boolean;
  lastSuccessfulIngestion: string | null;
}

export interface CoverageRowDTO {
  conflict: ConflictDTO;
  family: { id: string; slug: string; name: string } | null;
  geography: ConflictGeography;
  status: RegistryStatus;
  health: CoverageHealth;
  reasons: string[];
  enabledSources: number;
  dedicatedSources: number;
  specialistSources: number;
  generalSources: number;
  aggregatorSources: number;
  tiers: TierCounts;
  tierDiversity: number;
  independentSources: number;
  latestSourceAt: string | null;
  latestEventAt: string | null;
  /** Latest report ingested from a conflict-specific source. */
  latestReportAt: string | null;
  hasDedicatedSource: boolean;
  hasTerritorialData: boolean;
  territorialAreas: number;
  actorCount: number;
  candidateSourceCount: number;
  flags: { missingActors: boolean; missingFightingGeography: boolean; missingParticipants: boolean; unreviewedGeography: boolean };
  sources: CoverageSourceDTO[];
  actors: { name: string; role: string }[];
}

export interface CoverageFilter {
  region?: string;
  status?: string;
  severity?: string;
  health?: string;
  /** true = has a dedicated source, false = has none. */
  dedicated?: boolean;
  /** true = has territorial data, false = has none. */
  territorial?: boolean;
  familySlug?: string;
}

export interface CoverageResult {
  summary: CoverageSummary;
  /** Rows matching the filter. */
  rows: CoverageRowDTO[];
  matched: number;
  generatedAt: string;
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

async function loadRows(now: Date): Promise<CoverageRowDTO[]> {
  const [conflicts, sources, links, eventLatest, contributions, territories, participants, candidateCounts, itemLatest] = await Promise.all([
    prisma.conflict.findMany({ include: { family: true }, orderBy: { name: "asc" } }),
    prisma.source.findMany({ select: { id: true, name: true, enabled: true, sourceRole: true, country: true, lastSuccessfulIngestion: true } }),
    prisma.sourceConflictLink.findMany({ select: { sourceId: true, conflictId: true, scope: true } }),
    prisma.event.groupBy({ by: ["conflictId"], where: { published: true, conflictId: { not: null } }, _max: { occurredAt: true } }),
    prisma.eventSource.findMany({
      where: { event: { published: true, conflictId: { not: null } } },
      select: { event: { select: { conflictId: true } }, rawIngestionItem: { select: { sourceId: true } } },
    }),
    prisma.conflictTerritory.groupBy({ by: ["conflictId"], where: { published: true }, _count: { _all: true } }),
    prisma.conflictParticipant.findMany({ include: { unit: { select: { name: true } } } }),
    prisma.sourceCandidate.groupBy({ by: ["conflictId"], where: { status: { in: ["candidate", "approved"] } }, _count: { _all: true } }),
    prisma.rawIngestionItem.groupBy({ by: ["sourceId"], _max: { receivedAt: true } }),
  ]);
  const latestItemBySource = new Map(itemLatest.map((i) => [i.sourceId, i._max.receivedAt]));

  const sourceById = new Map(sources.map((s) => [s.id, s]));
  const latestEvent = new Map(eventLatest.map((e) => [e.conflictId, e._max.occurredAt]));
  const territoryCount = new Map(territories.map((t) => [t.conflictId, t._count._all]));
  const candidateCount = new Map(candidateCounts.map((c) => [c.conflictId, c._count._all]));
  // How many published events each source contributed to each conflict. A source
  // only counts as coverage for a conflict it merely mentions once it has
  // contributed COVERAGE_THRESHOLDS.minContributedEvents.
  const contributedCounts = new Map<string, Map<string, number>>();
  for (const c of contributions) {
    const conflictId = c.event.conflictId;
    if (!conflictId) continue;
    const perSource = contributedCounts.get(conflictId) ?? contributedCounts.set(conflictId, new Map()).get(conflictId)!;
    perSource.set(c.rawIngestionItem.sourceId, (perSource.get(c.rawIngestionItem.sourceId) ?? 0) + 1);
  }
  const contributed = new Map<string, string[]>();
  for (const [conflictId, perSource] of contributedCounts) {
    contributed.set(conflictId, [...perSource].filter(([, n]) => n >= COVERAGE_THRESHOLDS.minContributedEvents).map(([id]) => id));
  }

  return conflicts.map((c): CoverageRowDTO => {
    const geography = conflictGeographyOf(c);
    const relevant = new Map<string, CoverageSource>();
    const add = (sourceId: string, link: CoverageSource["link"]) => {
      const s = sourceById.get(sourceId);
      if (!s) return;
      const existing = relevant.get(sourceId);
      // An explicit dedicated link outranks a derived one.
      if (existing && (existing.link === "dedicated" || link !== "dedicated")) return;
      relevant.set(sourceId, { id: s.id, name: s.name, enabled: s.enabled, sourceRole: s.sourceRole, link, lastSuccessfulIngestion: s.lastSuccessfulIngestion });
    };
    for (const l of links.filter((x) => x.conflictId === c.id)) add(l.sourceId, l.scope === "dedicated" ? "dedicated" : "general");
    for (const s of sources) if (s.country && geography.fighting.includes(s.country.toUpperCase())) add(s.id, "derived");
    for (const sourceId of contributed.get(c.id) ?? []) add(sourceId, "derived");

    // Reporting activity: newest ingested item from a source that is specific to this
    // conflict (dedicated link, or based in a country where it is fought).
    const reportTimes = [...relevant.values()]
      .filter((s) => s.enabled && (s.link === "dedicated" || (sourceById.get(s.id)?.country && geography.fighting.includes(sourceById.get(s.id)!.country!.toUpperCase()))))
      .map((s) => latestItemBySource.get(s.id)?.getTime())
      .filter((t): t is number => typeof t === "number");
    const latestReportAt = reportTimes.length > 0 ? new Date(Math.max(...reportTimes)) : null;

    const actors = participants.filter((p) => p.conflictId === c.id).map((p) => ({ name: p.unit.name, role: p.role }));
    const territorialAreas = territoryCount.get(c.id) ?? 0;
    const coverage = computeCoverage(
      {
        status: c.status,
        fullScaleWar: c.fullScaleWar,
        sources: [...relevant.values()],
        latestEventAt: latestEvent.get(c.id) ?? null,
        latestReportAt,
        territorialAreas,
        actorCount: actors.length,
        geography,
      },
      now,
    );
    return {
      conflict: toConflictDTO(c),
      family: c.family ? { id: c.family.id, slug: c.family.slug, name: c.family.name } : null,
      geography,
      status: coverage.status,
      health: coverage.health,
      reasons: coverage.reasons,
      enabledSources: coverage.enabledSources,
      dedicatedSources: coverage.dedicatedSources,
      specialistSources: coverage.specialistSources,
      generalSources: coverage.generalSources,
      aggregatorSources: coverage.aggregatorSources,
      tiers: coverage.tiers,
      tierDiversity: coverage.tierDiversity,
      independentSources: coverage.independentSources,
      latestSourceAt: iso(coverage.latestSourceAt),
      latestEventAt: iso(coverage.latestEventAt),
      latestReportAt: iso(coverage.latestReportAt),
      hasDedicatedSource: coverage.hasDedicatedSource,
      hasTerritorialData: coverage.hasTerritorialData,
      territorialAreas,
      actorCount: actors.length,
      candidateSourceCount: candidateCount.get(c.id) ?? 0,
      flags: coverage.flags,
      sources: [...relevant.values()]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((s) => ({ id: s.id, name: s.name, kind: classifySource(s), tier: sourceTierOf(s.sourceRole), link: s.link, enabled: s.enabled, lastSuccessfulIngestion: iso(s.lastSuccessfulIngestion) })),
      actors,
    };
  });
}

export function matchesFilter(row: CoverageRowDTO, f: CoverageFilter): boolean {
  if (f.region && row.conflict.region !== f.region) return false;
  if (f.status && row.status !== normalizeConflictStatus(f.status)) return false;
  if (f.severity && row.conflict.severity !== f.severity) return false;
  if (f.health && row.health !== f.health) return false;
  if (f.dedicated !== undefined && row.hasDedicatedSource !== f.dedicated) return false;
  if (f.territorial !== undefined && row.hasTerritorialData !== f.territorial) return false;
  if (f.familySlug && row.family?.slug !== f.familySlug) return false;
  return true;
}

export async function listCoverage(filter: CoverageFilter = {}, now: Date = new Date()): Promise<CoverageResult> {
  const all = await loadRows(now);
  const rows = all.filter((r) => matchesFilter(r, filter));
  // Summary is always over the whole registry; the filter only narrows `rows`.
  const summary = summarizeCoverage(
    all.map((r) => ({
      coverage: {
        status: r.status,
        health: r.health,
        latestEventAt: r.latestEventAt ? new Date(r.latestEventAt) : null,
        latestSourceAt: r.latestSourceAt ? new Date(r.latestSourceAt) : null,
        hasDedicatedSource: r.hasDedicatedSource,
        hasTerritorialData: r.hasTerritorialData,
        flags: r.flags,
      } as never,
    })),
    now,
  );
  return { summary, rows, matched: rows.length, generatedAt: now.toISOString() };
}

export async function getCoverageRow(conflictId: string, now: Date = new Date()): Promise<CoverageRowDTO | null> {
  return (await loadRows(now)).find((r) => r.conflict.id === conflictId) ?? null;
}
