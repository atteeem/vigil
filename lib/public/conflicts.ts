import { prisma } from "@/lib/db/client";
import type { Conflict as ConflictRow, ConflictFamily } from "@prisma/client";
import type { Conflict } from "@/lib/types";
import type { Region, Severity } from "@/lib/types/severity";
import { conflictGeographyOf } from "@/lib/registry/geography";
import { normalizeConflictStatus } from "@/lib/registry/status";
import { getCountryByCode } from "@/lib/reference/countries";
import { severityFromScore } from "@/lib/utils/severity";

// THE public conflict source. Every public surface (homepage, globe, /world,
// For You, conflict/country pages, search) reads conflicts through here, so
// there is exactly one DB row -> UI `Conflict` mapping and one severity
// derivation. Nothing in this module (or any public path) generates data.

const SEVERITIES: readonly string[] = ["stable", "guarded", "elevated", "high", "severe", "extreme"];

function jsonStrings(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

export interface ConflictStats {
  eventCount: number;
  lastEventAt: Date | null;
}

/** DB row -> the UI Conflict. Severity is the stored label when valid, else derived
 * from intensity through the single centralized threshold function. */
export function toPublicConflict(row: ConflictRow & { family?: Pick<ConflictFamily, "slug"> | null }, stats: ConflictStats): Conflict {
  const geography = conflictGeographyOf(row);
  const anchorCountry = geography.fighting.map((c) => getCountryByCode(c)).find(Boolean);
  const hasPoint = row.lat != null && row.lng != null;
  const severity = (SEVERITIES.includes(row.severity) ? row.severity : severityFromScore(row.intensity)) as Severity;
  const status = normalizeConflictStatus(row.status);
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    shortName: row.shortName ?? row.name,
    region: row.region as Region,
    status,
    severity,
    intensity: row.intensity,
    intensityChange24h: row.intensityChange24h,
    startedAt: row.startedAt ? row.startedAt.toISOString() : null,
    lat: hasPoint ? row.lat! : (anchorCountry?.lat ?? 0),
    lng: hasPoint ? row.lng! : (anchorCountry?.lng ?? 0),
    locationKnown: hasPoint || Boolean(anchorCountry),
    primaryEffects: jsonStrings(row.primaryEffects),
    summary: row.summary ?? "",
    eventCount: stats.eventCount,
    lastEventAt: stats.lastEventAt ? stats.lastEventAt.toISOString() : null,
    updatedAt: row.updatedAt.toISOString(),
    fullScaleWar: row.fullScaleWar,
    classificationConfidence: row.classificationConfidence,
    familySlug: row.family?.slug ?? null,
    countryCodesInvolved: geography.participants,
    fightingCountryCodes: geography.fighting,
    participantCountryCodes: geography.participants,
    supporterCountryCodes: geography.supporters,
  };
}

/** Per-conflict published-event count and latest event time in ONE grouped query. */
async function statsByConflict(): Promise<Map<string, ConflictStats>> {
  const groups = await prisma.event.groupBy({
    by: ["conflictId"],
    where: { published: true, conflictId: { not: null } },
    _count: { _all: true },
    _max: { occurredAt: true },
  });
  const map = new Map<string, ConflictStats>();
  for (const g of groups) if (g.conflictId) map.set(g.conflictId, { eventCount: g._count._all, lastEventAt: g._max.occurredAt });
  return map;
}

/** Conflicts shown publicly: every registry conflict that has not ended, plus dormant ones. */
export async function listPublicConflicts(options: { includeEnded?: boolean } = {}): Promise<Conflict[]> {
  const [rows, stats] = await Promise.all([
    prisma.conflict.findMany({ include: { family: { select: { slug: true } } }, orderBy: { name: "asc" } }),
    statsByConflict(),
  ]);
  return rows
    .map((row) => toPublicConflict(row, stats.get(row.id) ?? { eventCount: 0, lastEventAt: null }))
    .filter((c) => options.includeEnded || c.status !== "ended");
}

export async function getPublicConflictBySlug(slug: string): Promise<Conflict | null> {
  const row = await prisma.conflict.findUnique({ where: { slug }, include: { family: { select: { slug: true } } } });
  if (!row) return null;
  const [count, latest] = await Promise.all([
    prisma.event.count({ where: { conflictId: row.id, published: true } }),
    prisma.event.aggregate({ where: { conflictId: row.id, published: true }, _max: { occurredAt: true } }),
  ]);
  return toPublicConflict(row, { eventCount: count, lastEventAt: latest._max.occurredAt });
}
