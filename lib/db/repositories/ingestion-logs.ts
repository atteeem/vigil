import { prisma } from "@/lib/db/client";

// Append-only log of every poll attempt (scheduled or manual) — see
// prisma/schema.prisma's IngestionLog comment for why this exists
// alongside Source's own denormalized lastAttemptedAt/lastError fields.

export interface IngestionLogInput {
  sourceId: string;
  fetched: number;
  newCount: number;
  alreadyKnown: number;
  success: boolean;
  errorMessage?: string | null;
}

export function recordIngestionAttempt(input: IngestionLogInput) {
  return prisma.ingestionLog.create({
    data: {
      sourceId: input.sourceId,
      fetched: input.fetched,
      newCount: input.newCount,
      alreadyKnown: input.alreadyKnown,
      success: input.success,
      errorMessage: input.errorMessage ?? null,
    },
  });
}

export interface DailyIngestionStats {
  newItemsToday: number;
  errorsToday: number;
}

/** One grouped query across all sources rather than N per-source queries —
 * called once per /admin/sources list request. */
export async function getDailyIngestionStatsBySource(startOfToday: Date): Promise<Map<string, DailyIngestionStats>> {
  const logs = await prisma.ingestionLog.findMany({
    where: { attemptedAt: { gte: startOfToday } },
    select: { sourceId: true, newCount: true, success: true },
  });
  const bySource = new Map<string, DailyIngestionStats>();
  for (const log of logs) {
    const stats = bySource.get(log.sourceId) ?? { newItemsToday: 0, errorsToday: 0 };
    stats.newItemsToday += log.newCount;
    if (!log.success) stats.errorsToday += 1;
    bySource.set(log.sourceId, stats);
  }
  return bySource;
}
