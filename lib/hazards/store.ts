import { createHash } from "node:crypto";
import type { GlobalEvent } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import type { NormalizedGlobalEvent, ProviderResult } from "./types";

// The one write path for structured events. Idempotent by (provider, providerEventId); a provider
// revision updates the row and records a revision snapshot; absence from a COMPLETE snapshot
// withdraws the event; observedAt/firstSeenAt are never rewritten by an update.

export interface IngestStats {
  created: number;
  updated: number;
  unchanged: number;
  withdrawn: number;
  superseded: number;
}

const CHUNK = 500;
/** Observations that never change once reported: fast bulk path, no per-row revision history. */
const IMMUTABLE_CATEGORIES = new Set(["thermal_detection"]);

const chunks = <T>(arr: T[], n = CHUNK): T[][] => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));
const json = (v: unknown) => (v == null ? null : JSON.stringify(v));

function bboxOf(ev: NormalizedGlobalEvent): [number, number, number, number] {
  return ev.bbox ?? [ev.lng, ev.lat, ev.lng, ev.lat];
}

function hashOf(ev: NormalizedGlobalEvent): string {
  return createHash("sha1")
    .update(
      JSON.stringify([ev.title, ev.description, ev.severityValue, ev.severityLabel, ev.prominence, ev.confidenceLabel, ev.confidenceValue, ev.expiresAt?.toISOString(), ev.endedAt?.toISOString(), ev.providerUpdatedAt?.toISOString(), ev.geometry, ev.lat, ev.lng, ev.metadata]),
    )
    .digest("hex");
}

function rowData(ev: NormalizedGlobalEvent, sourceId: string | null) {
  const [minLng, minLat, maxLng, maxLat] = bboxOf(ev);
  return {
    origin: ev.origin,
    category: ev.category,
    layer: ev.layer,
    subtype: ev.subtype ?? null,
    provider: ev.provider,
    providerEventId: ev.providerEventId,
    sourceId,
    title: ev.title,
    description: ev.description ?? null,
    severityDomain: ev.severityDomain ?? null,
    severityValue: ev.severityValue ?? null,
    severityLabel: ev.severityLabel ?? null,
    prominence: ev.prominence,
    confidenceLabel: ev.confidenceLabel ?? null,
    confidenceValue: ev.confidenceValue ?? null,
    geometryType: ev.geometry ? "polygon" : "point",
    geometry: json(ev.geometry),
    lat: ev.lat,
    lng: ev.lng,
    minLat,
    maxLat,
    minLng,
    maxLng,
    locationPrecision: ev.locationPrecision ?? "exact",
    observedAt: ev.observedAt,
    providerUpdatedAt: ev.providerUpdatedAt ?? null,
    effectiveAt: ev.effectiveAt ?? null,
    expiresAt: ev.expiresAt ?? null,
    endedAt: ev.endedAt ?? null,
    sourceUrl: ev.sourceUrl ?? null,
    metadata: json(ev.metadata),
    contentHash: hashOf(ev),
  };
}

/** The volatile fields of a row: what the timeline needs to show it as it was at an earlier moment. */
export function snapshotOf(row: Pick<GlobalEvent, "title" | "description" | "severityDomain" | "severityValue" | "severityLabel" | "prominence" | "confidenceLabel" | "confidenceValue" | "geometry" | "lat" | "lng" | "expiresAt" | "endedAt" | "providerUpdatedAt" | "metadata" | "sourceUrl">) {
  return {
    title: row.title,
    description: row.description,
    severityDomain: row.severityDomain,
    severityValue: row.severityValue,
    severityLabel: row.severityLabel,
    prominence: row.prominence,
    confidenceLabel: row.confidenceLabel,
    confidenceValue: row.confidenceValue,
    geometry: row.geometry,
    lat: row.lat,
    lng: row.lng,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    endedAt: row.endedAt?.toISOString() ?? null,
    providerUpdatedAt: row.providerUpdatedAt?.toISOString() ?? null,
    metadata: row.metadata,
    sourceUrl: row.sourceUrl,
  };
}

async function markEnded(rows: { id: string; revision: number }[], now: Date): Promise<number> {
  let n = 0;
  for (const r of rows) {
    const updated = await prisma.globalEvent.update({ where: { id: r.id }, data: { endedAt: now, revision: { increment: 1 }, lastSeenAt: now } });
    await prisma.globalEventRevision.create({ data: { globalEventId: r.id, revision: updated.revision, providerUpdatedAt: now, snapshot: JSON.stringify(snapshotOf(updated)) } });
    n += 1;
  }
  return n;
}

export async function ingestGlobalEvents(provider: string, sourceId: string | null, result: ProviderResult, now: Date = new Date()): Promise<IngestStats> {
  const stats: IngestStats = { created: 0, updated: 0, unchanged: 0, withdrawn: 0, superseded: 0 };
  // Duplicate ids inside one feed collapse to the last occurrence.
  const events = [...new Map(result.events.filter((e) => e.provider === provider).map((e) => [e.providerEventId, e])).values()];

  const existing = new Map<string, GlobalEvent>();
  for (const ids of chunks(events.map((e) => e.providerEventId))) {
    for (const row of await prisma.globalEvent.findMany({ where: { provider, providerEventId: { in: ids } } })) existing.set(row.providerEventId, row);
  }

  const fresh = events.filter((e) => !existing.has(e.providerEventId));
  const freshImmutable = fresh.filter((e) => IMMUTABLE_CATEGORIES.has(e.category));
  for (const batch of chunks(freshImmutable)) {
    const r = await prisma.globalEvent.createMany({ data: batch.map((e) => rowData(e, sourceId)) });
    stats.created += r.count;
  }
  for (const ev of fresh.filter((e) => !IMMUTABLE_CATEGORIES.has(e.category))) {
    const data = rowData(ev, sourceId);
    const row = await prisma.globalEvent.create({ data: { ...data, firstSeenAt: now, lastSeenAt: now } });
    await prisma.globalEventRevision.create({ data: { globalEventId: row.id, revision: 1, providerUpdatedAt: row.providerUpdatedAt, snapshot: JSON.stringify(snapshotOf(row)) } });
    stats.created += 1;
  }

  const untouched: string[] = [];
  for (const ev of events) {
    const row = existing.get(ev.providerEventId);
    if (!row) continue;
    if (IMMUTABLE_CATEGORIES.has(ev.category)) {
      stats.unchanged += 1;
      untouched.push(row.id);
      continue;
    }
    const data = rowData(ev, sourceId);
    // An out-of-order older copy of the event never overwrites a newer one.
    const outdated = row.providerUpdatedAt && ev.providerUpdatedAt && ev.providerUpdatedAt.getTime() < row.providerUpdatedAt.getTime();
    if (outdated || data.contentHash === row.contentHash) {
      stats.unchanged += 1;
      untouched.push(row.id);
      continue;
    }
    // observedAt / firstSeenAt describe the FIRST sighting and are never moved by a revision
    // (except a provider that re-dates the start itself, which is not modelled here).
    const { observedAt: _observedAt, ...revised } = data;
    void _observedAt;
    const updated = await prisma.globalEvent.update({
      where: { id: row.id },
      data: { ...revised, // a provider that has un-ended an event (re-issued alert id) reopens it
        endedAt: ev.endedAt ?? null, revision: { increment: 1 }, lastSeenAt: now },
    });
    await prisma.globalEventRevision.create({ data: { globalEventId: row.id, revision: updated.revision, providerUpdatedAt: updated.providerUpdatedAt, snapshot: JSON.stringify(snapshotOf(updated)) } });
    stats.updated += 1;
  }
  for (const ids of chunks(untouched, 800)) await prisma.globalEvent.updateMany({ where: { id: { in: ids } }, data: { lastSeenAt: now } });

  // A complete snapshot: anything active that the provider no longer lists has been withdrawn/closed.
  if (result.snapshot) {
    const seen = new Set(result.seenProviderIds ?? events.map((e) => e.providerEventId));
    const active = await prisma.globalEvent.findMany({ where: { provider, endedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }, select: { id: true, providerEventId: true, revision: true } });
    stats.withdrawn = await markEnded(active.filter((r) => !seen.has(r.providerEventId)), now);
  }

  // Messages the feed says are replaced by newer ones (CAP references) are ended too.
  if (result.supersedes?.length) {
    const live = new Set(events.map((e) => e.providerEventId));
    const stale = await prisma.globalEvent.findMany({ where: { provider, endedAt: null, providerEventId: { in: result.supersedes.filter((id) => !live.has(id)) } }, select: { id: true, revision: true } });
    stats.superseded = await markEnded(stale, now);
  }
  return stats;
}

// ---------------------------------------------------------------------------------------------
// Retention. Hot table: thermal detections live 7 days raw, then survive as per-day grid-cell
// aggregates (0.5 degree). Alerts/cyclones/floods are dropped 60 days after they end. Earthquakes and
// volcano records are low volume and kept.
// ---------------------------------------------------------------------------------------------
export const THERMAL_RETENTION_DAYS = 7;
export const ALERT_RETENTION_DAYS = 60;
const CELL_DEG = 0.5;
const DAY_MS = 86_400_000;

export async function runHazardRetention(now: Date = new Date()): Promise<{ archivedRows: number; removedAlerts: number }> {
  let archivedRows = 0;
  const cutoff = new Date(now.getTime() - THERMAL_RETENTION_DAYS * DAY_MS);
  for (let pass = 0; pass < 10; pass++) {
    const rows = await prisma.globalEvent.findMany({ where: { category: "thermal_detection", observedAt: { lt: cutoff } }, select: { id: true, provider: true, lat: true, lng: true, severityValue: true, observedAt: true }, take: 5000 });
    if (rows.length === 0) break;
    const cells = new Map<string, { provider: string; day: string; cellLat: number; cellLng: number; count: number; sum: number; max: number }>();
    for (const r of rows) {
      const day = r.observedAt.toISOString().slice(0, 10);
      const cellLat = Math.floor(r.lat / CELL_DEG) * CELL_DEG + CELL_DEG / 2;
      const cellLng = Math.floor(r.lng / CELL_DEG) * CELL_DEG + CELL_DEG / 2;
      const key = `${r.provider}|${day}|${cellLat}|${cellLng}`;
      const c = cells.get(key) ?? { provider: r.provider, day, cellLat, cellLng, count: 0, sum: 0, max: 0 };
      c.count += 1;
      c.sum += r.severityValue ?? 0;
      c.max = Math.max(c.max, r.severityValue ?? 0);
      cells.set(key, c);
    }
    await prisma.$transaction(async (tx) => {
      for (const c of cells.values()) {
        const where = { provider_category_day_cellLat_cellLng: { provider: c.provider, category: "thermal_detection", day: c.day, cellLat: c.cellLat, cellLng: c.cellLng } };
        const prev = await tx.globalEventAggregate.findUnique({ where });
        if (prev) await tx.globalEventAggregate.update({ where, data: { count: prev.count + c.count, sumIntensity: (prev.sumIntensity ?? 0) + c.sum, maxIntensity: Math.max(prev.maxIntensity ?? 0, c.max) } });
        else await tx.globalEventAggregate.create({ data: { provider: c.provider, category: "thermal_detection", day: c.day, cellLat: c.cellLat, cellLng: c.cellLng, count: c.count, sumIntensity: c.sum, maxIntensity: c.max } });
      }
      await tx.globalEvent.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
    }, { timeout: 60_000 });
    archivedRows += rows.length;
  }
  const alertCutoff = new Date(now.getTime() - ALERT_RETENTION_DAYS * DAY_MS);
  const removed = await prisma.globalEvent.deleteMany({
    where: {
      category: { in: ["weather_alert", "cyclone", "flood", "confirmed_wildfire"] },
      OR: [{ endedAt: { lt: alertCutoff } }, { AND: [{ endedAt: null }, { expiresAt: { lt: alertCutoff } }] }],
    },
  });
  return { archivedRows, removedAlerts: removed.count };
}
