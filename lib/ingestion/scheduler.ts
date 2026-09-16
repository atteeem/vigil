import { prisma } from "@/lib/db/client";
import { pollSource } from "@/lib/ingestion/poll";

// Per-source polling scheduler (spec "Source Scheduler") — each enabled +
// auto-ingest source is polled on its own pollIntervalMinutes, not a
// single blanket interval for every source. A source is "due" once its
// nextPollAt has passed (or was never set, e.g. a brand-new source);
// lib/ingestion/poll.ts's pollSource() is what actually advances
// nextPollAt afterward, with backoff on failure.

// In-memory only — this is a single-process local-development server (see
// Decisions.md "Current backend strategy"), so a plain Set is sufficient
// to stop the SAME source being polled twice concurrently if a tick fires
// again before a slow fetch finishes; it does not need to survive a
// restart, since nothing is "in flight" across process boundaries.
const inFlightSourceIds = new Set<string>();

export interface SchedulerTickResult {
  due: number;
  polled: number;
  skippedInFlight: number;
}

/** Runs one scheduler pass: finds every enabled + auto-ingest source whose
 * nextPollAt has arrived (or is unset) and polls each one, skipping any
 * already mid-poll from a previous tick. Sources are polled concurrently
 * via Promise.allSettled — one source's failure or hang (bounded by
 * pollSource's own fetch timeout) never blocks another (spec "A failed
 * source must not break other sources").
 *
 * `sourceIds`, when passed, additionally restricts the due-set to those
 * ids — the real background loop never passes it (a real tick considers
 * every due source), but tests/multi-source-ingestion.spec.ts does, so
 * exercising scheduler logic never triggers a real poll of this project's
 * live RSS sources (BBC, Al Jazeera, etc.) as a side effect of running
 * the test suite. */
export async function schedulerTick(now = new Date(), sourceIds?: string[]): Promise<SchedulerTickResult> {
  const due = await prisma.source.findMany({
    where: {
      enabled: true,
      autoIngest: true,
      OR: [{ nextPollAt: null }, { nextPollAt: { lte: now } }],
      ...(sourceIds ? { id: { in: sourceIds } } : {}),
    },
  });

  let skippedInFlight = 0;
  const toPoll = due.filter((source) => {
    if (inFlightSourceIds.has(source.id)) {
      skippedInFlight++;
      return false;
    }
    return true;
  });

  for (const source of toPoll) inFlightSourceIds.add(source.id);
  await Promise.allSettled(
    toPoll.map((source) => pollSource(source).finally(() => inFlightSourceIds.delete(source.id))),
  );

  return { due: due.length, polled: toPoll.length, skippedInFlight };
}

const DEFAULT_TICK_INTERVAL_MS = 30_000;

/** Starts the server-side scheduler loop once per server process. Guarded
 * by a global flag the same way lib/db/client.ts guards the PrismaClient
 * singleton, so a dev-mode hot reload never stacks up duplicate intervals.
 * Called from instrumentation.ts on server startup. The tick itself runs
 * far more often than any source's actual poll interval (default 5min for
 * RSS) — it's cheap (one indexed query when nothing is due) and is what
 * lets each source's own interval/backoff take effect promptly. */
export function startScheduler(tickIntervalMs = DEFAULT_TICK_INTERVAL_MS) {
  const g = globalThis as unknown as { __vigilScheduler?: boolean };
  if (g.__vigilScheduler) return;
  g.__vigilScheduler = true;

  console.log(`[ingestion] scheduler started (tick every ${tickIntervalMs}ms)`);
  const tick = () => {
    schedulerTick()
      .then(({ due, polled, skippedInFlight }) => {
        if (polled > 0) console.log(`[ingestion] scheduler tick: ${polled}/${due} due source(s) polled${skippedInFlight ? `, ${skippedInFlight} already in flight` : ""}`);
      })
      .catch((err) => console.error("[ingestion] scheduler tick failed:", err));
  };
  tick();
  setInterval(tick, tickIntervalMs);
}
