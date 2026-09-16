import { prisma } from "@/lib/db/client";
import type { Conflict } from "@prisma/client";
import type { ConflictDTO } from "@/lib/types/db";

export interface ConflictInput {
  slug: string;
  name: string;
  shortName?: string | null;
  region: string;
  status?: string;
  severity: string;
  intensity: number;
  intensityChange24h?: number;
  startedAt?: Date | null;
  lat?: number | null;
  lng?: number | null;
  primaryEffects?: string[];
  countries?: string[];
  summary?: string | null;
}

export interface ConflictWithEventCount extends Conflict {
  eventCount: number;
}

function toRow(input: Partial<ConflictInput>) {
  const row: Record<string, unknown> = { ...input };
  if (input.primaryEffects) row.primaryEffects = JSON.stringify(input.primaryEffects);
  if (input.countries) row.countries = JSON.stringify(input.countries);
  return row;
}

/** `countries` is stored as a JSON-encoded string (SQLite has no array
 * type) — this is the one place that parses it back before a conflict
 * crosses the API boundary to a client component. */
export function toConflictDTO(c: Conflict & { eventCount?: number }): ConflictDTO {
  let countries: string[] = [];
  if (c.countries) {
    try {
      countries = JSON.parse(c.countries) as string[];
    } catch {
      countries = [];
    }
  }
  return {
    id: c.id,
    slug: c.slug,
    name: c.name,
    shortName: c.shortName,
    region: c.region,
    status: c.status as ConflictDTO["status"],
    severity: c.severity,
    intensity: c.intensity,
    startedAt: c.startedAt ? c.startedAt.toISOString() : null,
    lat: c.lat,
    lng: c.lng,
    countries,
    summary: c.summary,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
    ...(c.eventCount !== undefined ? { eventCount: c.eventCount } : {}),
  };
}

export function listConflicts(): Promise<Conflict[]> {
  return prisma.conflict.findMany({ orderBy: { name: "asc" } });
}

/** Selectable in the review/publish conflict picker — archived and
 * resolved conflicts stay visible in /admin/conflicts but drop out of the
 * picker so old reports aren't misassigned to a closed-out conflict. */
export function listSelectableConflicts(): Promise<Conflict[]> {
  return prisma.conflict.findMany({
    where: { status: { in: ["active", "dormant"] } },
    orderBy: { name: "asc" },
  });
}

export async function listConflictsWithEventCounts(): Promise<ConflictWithEventCount[]> {
  const conflicts = await prisma.conflict.findMany({ orderBy: { name: "asc" } });
  return Promise.all(
    conflicts.map(async (c) => ({ ...c, eventCount: await prisma.event.count({ where: { conflictId: c.id } }) })),
  );
}

export function getConflictBySlug(slug: string): Promise<Conflict | null> {
  return prisma.conflict.findUnique({ where: { slug } });
}

/** Used by the automated draft-extraction heuristic (lib/ingestion/draft.ts)
 * to suggest a conflict from a resolved location's country code — never
 * used to silently assign, only to pre-fill a suggestion the human
 * reviews. Picks the first active/dormant conflict whose `countries`
 * list includes the code. */
export async function findConflictByCountryCode(countryCode: string): Promise<Conflict | null> {
  const conflicts = await listSelectableConflicts();
  return (
    conflicts.find((c) => {
      if (!c.countries) return false;
      try {
        const codes = JSON.parse(c.countries) as string[];
        return codes.includes(countryCode);
      } catch {
        return false;
      }
    }) ?? null
  );
}

export function getConflict(id: string): Promise<Conflict | null> {
  return prisma.conflict.findUnique({ where: { id } });
}

export function createConflict(input: ConflictInput): Promise<Conflict> {
  return prisma.conflict.create({ data: toRow(input) as never });
}

export function updateConflict(id: string, input: Partial<ConflictInput>): Promise<Conflict> {
  return prisma.conflict.update({ where: { id }, data: toRow(input) as never });
}

export function setConflictStatus(id: string, status: string): Promise<Conflict> {
  return prisma.conflict.update({ where: { id }, data: { status } });
}

/** "delete only when safe" (spec §1) — a conflict with any linked events
 * can't be hard-deleted (would silently orphan real published events'
 * history); archive it instead. Returns null on a safe delete, or the
 * blocking event count if unsafe. */
export async function deleteConflictIfSafe(id: string): Promise<{ deleted: boolean; linkedEventCount: number }> {
  const linkedEventCount = await prisma.event.count({ where: { conflictId: id } });
  if (linkedEventCount > 0) return { deleted: false, linkedEventCount };
  await prisma.conflict.delete({ where: { id } });
  return { deleted: true, linkedEventCount: 0 };
}
