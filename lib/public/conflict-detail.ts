import { prisma } from "@/lib/db/client";
import type { Conflict, ConflictEvent } from "@/lib/types";
import { getCoverageRow, type CoverageRowDTO } from "@/lib/db/repositories/coverage";
import { scoreConflict, type EntityScores } from "@/lib/db/repositories/scoring";
import { REGISTRY_STATUS_LABEL } from "@/lib/registry/status";
import { getCountryByCode } from "@/lib/reference/countries";
import { getPublicConflictBySlug } from "./conflicts";
import { listPublicEvents } from "./events";
import { resolveActorLinks, type ActorLink } from "./actors";
import { listConflictingClaims, type ConflictingClaims } from "./claims";
import { sourceTrust, type SourceTrust } from "@/lib/sources/trust";
import { getPublicTerritorySummary, listPublicTerritorialChanges, type PublicTerritorialChange, type PublicTerritorySummary } from "./territory";

// Everything the public conflict page shows, assembled from the existing
// registry, scoring, coverage, territorial-control and event systems. A section
// with no data comes back empty/null and the page renders an empty state — no
// section is ever filled with invented content.

export interface CountryRef {
  code: string;
  name: string;
}

export interface PublicConflictDetail {
  conflict: Conflict;
  statusLabel: string;
  family: { slug: string; name: string } | null;
  geography: { fighting: CountryRef[]; participants: CountryRef[]; supporters: CountryRef[]; regions: string[]; basis: string };
  scores: EntityScores | null;
  recentEvents: ConflictEvent[];
  activity: { last24h: number; last7d: number; last30d: number; total: number };
  history: { month: string; events: number }[];
  actors: (ActorLink & { role: string })[];
  /** Places where two sides both claim control (unresolved — no conclusion drawn). */
  conflictingClaims: ConflictingClaims[];
  territory: PublicTerritorySummary;
  territorialChanges: PublicTerritorialChange[];
  coverage: (Omit<Pick<CoverageRowDTO, "health" | "reasons" | "sources" | "dedicatedSources" | "tierDiversity" | "independentSources" | "latestSourceAt" | "latestEventAt" | "latestReportAt" | "enabledSources">, "sources"> & { sources: (CoverageRowDTO["sources"][number] & { trust: SourceTrust })[] }) | null;
  freshness: { lastEventAt: string | null; lastSourceFetchAt: string | null; conflictUpdatedAt: string; generatedAt: string };
}

const country = (code: string): CountryRef => ({ code, name: getCountryByCode(code)?.name ?? code });

export async function getPublicConflictDetail(slug: string, now: Date = new Date()): Promise<PublicConflictDetail | null> {
  const conflict = await getPublicConflictBySlug(slug);
  if (!conflict) return null;
  const row = await prisma.conflict.findUnique({ where: { id: conflict.id }, select: { regions: true, geographyBasis: true, family: { select: { slug: true, name: true } } } });
  const since = (days: number) => new Date(now.getTime() - days * 86_400_000);

  const [page, scores, coverage, territory, territorialChanges, unitRows, territoryActors, c24, c7, c30, yearRows, conflictingClaims] = await Promise.all([
    listPublicEvents({ conflictId: conflict.id, limit: 20, sinceDays: 3650 }),
    scoreConflict(conflict.id),
    getCoverageRow(conflict.id, now),
    getPublicTerritorySummary(conflict.id, now),
    listPublicTerritorialChanges({ conflictId: conflict.id, limit: 5 }),
    prisma.militaryUnit.findMany({ where: { primaryConflictId: conflict.id }, select: { name: true, unitType: true, branch: true }, orderBy: { name: "asc" }, take: 30 }),
    prisma.conflictActor.findMany({ where: { conflictId: conflict.id }, select: { name: true }, orderBy: { name: "asc" }, take: 30 }),
    prisma.event.count({ where: { conflictId: conflict.id, published: true, occurredAt: { gte: since(1) } } }),
    prisma.event.count({ where: { conflictId: conflict.id, published: true, occurredAt: { gte: since(7) } } }),
    prisma.event.count({ where: { conflictId: conflict.id, published: true, occurredAt: { gte: since(30) } } }),
    prisma.event.findMany({ where: { conflictId: conflict.id, published: true, occurredAt: { gte: since(365) } }, select: { occurredAt: true }, take: 5000 }),
    listConflictingClaims(conflict.id),
  ]);
  const sourceRows = coverage ? await prisma.source.findMany({ where: { id: { in: coverage.sources.map((s) => s.id) } }, select: { id: true, independenceClass: true, claimPolicy: true, sourceRole: true, perspective: true } }) : [];
  const trustById = new Map(sourceRows.map((s) => [s.id, sourceTrust(s)]));
  const roleByName = new Map<string, string>([...unitRows.map((u) => [u.name, u.unitType ?? u.branch ?? "Armed actor"] as [string, string]), ...territoryActors.map((a) => [a.name, "Territorial-control actor"] as [string, string])]);

  const months = new Map<string, number>();
  for (const e of yearRows) {
    const key = e.occurredAt.toISOString().slice(0, 7);
    months.set(key, (months.get(key) ?? 0) + 1);
  }
  const regions = (() => {
    try {
      const parsed = row?.regions ? (JSON.parse(row.regions) as unknown) : [];
      return Array.isArray(parsed) ? parsed.filter((r): r is string => typeof r === "string") : [];
    } catch {
      return [];
    }
  })();

  const sourceTimes = (coverage?.sources ?? []).map((s) => s.lastSuccessfulIngestion).filter((t): t is string => Boolean(t));
  return {
    conflict,
    statusLabel: REGISTRY_STATUS_LABEL[conflict.status as keyof typeof REGISTRY_STATUS_LABEL] ?? conflict.status,
    family: row?.family ?? null,
    geography: {
      fighting: conflict.fightingCountryCodes.map(country),
      participants: conflict.participantCountryCodes.map(country),
      supporters: conflict.supporterCountryCodes.map(country),
      regions,
      basis: row?.geographyBasis ?? "admin",
    },
    scores,
    recentEvents: page.events,
    activity: { last24h: c24, last7d: c7, last30d: c30, total: conflict.eventCount },
    history: [...months.entries()].sort(([a], [b]) => (a < b ? 1 : -1)).map(([month, events]) => ({ month, events })),
    actors: (await resolveActorLinks([...new Set([...unitRows, ...territoryActors].map((a) => a.name))])).map((a) => ({ ...a, role: roleByName.get(a.name) ?? "Actor" })),
    conflictingClaims,
    territory,
    territorialChanges,
    coverage: coverage
      ? {
          health: coverage.health,
          reasons: coverage.reasons,
          dedicatedSources: coverage.dedicatedSources,
          sources: coverage.sources.map((s) => ({ ...s, trust: trustById.get(s.id) ?? sourceTrust({}) })),
          tierDiversity: coverage.tierDiversity,
          independentSources: coverage.independentSources,
          latestSourceAt: coverage.latestSourceAt,
          latestEventAt: coverage.latestEventAt,
          latestReportAt: coverage.latestReportAt,
          enabledSources: coverage.enabledSources,
        }
      : null,
    freshness: {
      lastEventAt: conflict.lastEventAt,
      lastSourceFetchAt: sourceTimes.length ? sourceTimes.sort().at(-1)! : null,
      conflictUpdatedAt: conflict.updatedAt,
      generatedAt: now.toISOString(),
    },
  };
}
