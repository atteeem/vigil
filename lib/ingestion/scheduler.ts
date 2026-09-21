import { prisma } from "@/lib/db/client";
import type { Source } from "@prisma/client";
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

// Bounded fetch concurrency (spec "Ingestion Reliability Hardening") —
// firing every due source at once turned out to be a real problem, not
// just a theoretical one: this project's own sandbox network has limited
// concurrent-connection headroom, and polling ~9 real RSS sources in the
// same instant caused several to hit connect timeouts that succeeded
// individually moments later (see Decisions.md "Source polling"). A
// worker-pool of a few concurrent slots — a free slot immediately picks
// up the next due source — keeps total connections bounded without
// making a slow/hung source (bounded anyway by pollSource's own fetch
// timeout) block sources behind it in a queue.
const MAX_CONCURRENT_FETCHES = Math.max(1, Number(process.env.INGESTION_MAX_CONCURRENCY) || 4);

// A tick starts at most this many sources. After a long idle period (or on a fresh database) every source is due at
// once; processing each new item is synchronous database work on the server's only thread, so starting dozens at
// once starves page requests. The remainder simply stays due and is picked up by the following ticks (30 s apart),
// so every source is still polled. Development defaults to a small burst; production is unlimited unless set.
const MAX_SOURCES_PER_TICK = Number(process.env.INGESTION_MAX_SOURCES_PER_TICK) || (process.env.NODE_ENV === "production" ? Infinity : 12);

/** Runs `worker` over every item in `items`, at most `limit` concurrently.
 * A worker-pool, not batching by chunks — a slot frees up and immediately
 * picks up the next item the moment its own promise settles, rather than
 * waiting for the slowest item in a fixed-size batch. */
async function runWithConcurrencyLimit<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let nextIndex = 0;
  async function runNext(): Promise<void> {
    const index = nextIndex++;
    if (index >= items.length) return;
    await worker(items[index]!);
    await runNext();
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => runNext()));
}

export interface SchedulerTickResult {
  due: number;
  polled: number;
  skippedInFlight: number;
}

/** Runs one scheduler pass: finds every enabled + auto-ingest source whose
 * nextPollAt has arrived (or is unset) and polls each one, skipping any
 * already mid-poll from a previous tick. Due sources are polled with
 * bounded concurrency (MAX_CONCURRENT_FETCHES) — one source's failure or
 * hang (bounded by pollSource's own fetch timeout) never blocks another
 * (spec "A failed source must not break other sources"), and every due
 * source is eventually polled regardless of how many are due at once.
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

  // Only sources actually being polled are "in flight": marking the whole queue up front made a tick with 60 due
  // sources report 57 in flight while at most MAX_CONCURRENT_FETCHES were running. The tick itself is not
  // re-entrant either (see startScheduler), so nothing else can pick the queued ones up meanwhile.
  const batch = toPoll.slice(0, MAX_SOURCES_PER_TICK);
  await runWithConcurrencyLimit(batch, MAX_CONCURRENT_FETCHES, async (source: Source) => {
    inFlightSourceIds.add(source.id);
    try {
      await pollSource(source);
    } finally {
      inFlightSourceIds.delete(source.id);
    }
  });

  return { due: due.length, polled: batch.length, skippedInFlight };
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
  // Ticks never overlap: a slow pass (many due sources, slow feeds) is allowed to finish before the next starts.
  let running = false;
  const tick = () => {
    if (running) return;
    running = true;
    schedulerTick()
      .then(({ due, polled, skippedInFlight }) => {
        if (polled > 0) console.log(`[ingestion] scheduler tick: ${polled}/${due} due source(s) polled${skippedInFlight ? `, ${skippedInFlight} already in flight` : ""}`);
      })
      .catch((err) => console.error("[ingestion] scheduler tick failed:", err))
      .finally(() => {
        running = false;
      });
  };
  tick();
  setInterval(tick, tickIntervalMs);
}
