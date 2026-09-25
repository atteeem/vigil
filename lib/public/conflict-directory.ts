import { prisma } from "@/lib/db/client";
import { listPublicConflicts } from "./conflicts";
import { conflictReportCounts } from "./report-counts";
import { conflictConfidence, CONFIDENCE_WINDOW_DAYS } from "@/lib/db/repositories/scoring";
import { REGISTRY_STATUS_LABEL } from "@/lib/registry/status";

// The /conflicts directory in ONE bounded pass: every registry conflict (all statuses), its confidence on the canonical
// corroboration model (one query for all conflicts' recent evidence, grouped here — never a per-conflict page
// aggregation), its canonical 7-day unique report count, and its most recent published incident. No ranking is
// computed; the page sorts deterministically.

export interface DirectoryRow {
  id: string;
  slug: string;
  name: string;
  shortName: string;
  region: string;
  status: string;
  statusLabel: string;
  severity: string;
  intensity: number;
  fullScaleWar: boolean;
  confidence: number | null;
  reportCount7d: number;
  lastEventAt: string | null;
  eventCount: number;
}

export async function getConflictDirectory(now: Date = new Date()): Promise<DirectoryRow[]> {
  const [conflicts, counts, evidence] = await Promise.all([
    listPublicConflicts({ includeEnded: true }),
    conflictReportCounts({ window: "7D" }),
    prisma.event.findMany({
      where: { published: true, conflictId: { not: null }, occurredAt: { gte: new Date(now.getTime() - CONFIDENCE_WINDOW_DAYS * 86_400_000) } },
      select: { conflictId: true, occurredAt: true, sources: { select: { relationship: true, rawIngestionItem: { select: { originalUrl: true, publishedAt: true, receivedAt: true, source: { select: { id: true, sourceRole: true, independenceClass: true, claimPolicy: true, perspective: true, sourceCategory: true, type: true } } } } } } },
      orderBy: { occurredAt: "desc" },
      take: 5000,
    }),
  ]);
  const byConflict = new Map<string, typeof evidence>();
  for (const e of evidence) {
    const list = byConflict.get(e.conflictId!) ?? byConflict.set(e.conflictId!, []).get(e.conflictId!)!;
    if (list.length < 500) list.push(e);
  }
  return conflicts.map((c) => {
    const ev = byConflict.get(c.id) ?? [];
    return {
      id: c.id,
      slug: c.slug,
      name: c.name,
      shortName: c.shortName,
      region: c.region,
      status: c.status,
      statusLabel: REGISTRY_STATUS_LABEL[c.status as keyof typeof REGISTRY_STATUS_LABEL] ?? c.status,
      severity: c.severity,
      intensity: c.intensity,
      fullScaleWar: c.fullScaleWar,
      confidence: ev.length ? conflictConfidence(ev).confidenceScore : null,
      reportCount7d: counts.conflicts[c.id] ?? 0,
      lastEventAt: c.lastEventAt,
      eventCount: c.eventCount,
    };
  });
}
