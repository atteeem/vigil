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
// making a slow/hung source block sources behind it in a queue (see
// SOURCE_TIMEOUT_MS below for why "slow/hung" isn't only the fetch).
const MAX_CONCURRENT_FETCHES = Math.max(1, Number(process.env.INGESTION_MAX_CONCURRENCY) || 4);

// pollSource()'s own INGESTION_FETCH_TIMEOUT_MS only bounds the initial feed fetch — the per-new-item
// pipeline that runs after it (draft/snapshot, fact extraction, military-entity extraction,
// territorial-change detection; lib/ingestion/poll.ts) has no timeout of its own, so a source that
// returns many new items, or one whose pipeline hits a genuinely slow path on a particular item, could
// otherwise occupy a worker-pool slot indefinitely — confirmed directly: a production-mode run against
// a large real backlog left one worker stuck for minutes past the fetch timeout with zero further
// progress logged. This is the outer bound on the ENTIRE pollSource() call, fetch and pipeline together.
const SOURCE_TIMEOUT_MS = Number(process.env.INGESTION_SOURCE_TIMEOUT_MS) || 90_000;
function withSourceTimeout<T>(promise: Promise<T>, source: Source): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Polling ${source.name} timed out after ${SOURCE_TIMEOUT_MS}ms (fetch + processing combined)`)), SOURCE_TIMEOUT_MS);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

// A tick starts at most this many sources. After a long idle period (or on a fresh database) every source is due at
// once; processing each new item is synchronous database work on the server's only thread, so starting dozens at
// once starves page requests. The remainder simply stays due and is picked up by the following ticks (30 s apart),
// so every source is still polled, in bounded, resumable batches. This cap applies in every environment, including
// production — an earlier "unlimited unless set" production default defeated the very design this comment
// describes: with every source due at once (a fresh deploy, or any long idle period), an unbounded tick tries to
// process all of them in one pass. Each source's own progress (nextPollAt/lastAttemptedAt) does commit durably as
// soon as that source finishes — an interruption never re-does already-completed sources — but an unbounded tick
// has no predictable worst-case duration and gives an operator no visibility into whether it's "still working
// through a real backlog" or genuinely stuck; a bounded, same-size-every-environment batch keeps each tick's
// duration predictable and the backlog's drain rate observable via /api/health's scheduler.lastTickResult.
const MAX_SOURCES_PER_TICK = Number(process.env.INGESTION_MAX_SOURCES_PER_TICK) || 20;

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
      // pollSource() itself never throws for an ordinary per-source failure (see its own doc comment) —
      // only withSourceTimeout's own timeout rejects here. Caught locally, same as any other per-source
      // failure, so one slow source can never abort its concurrent siblings in the same batch (the
      // underlying pollSource() call is not cancelled — Node has no true promise cancellation — it keeps
      // running in the background and still records its own real result whenever it does finish).
      await withSourceTimeout(pollSource(source), source);
    } catch (err) {
      console.error(`[ingestion] ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      inFlightSourceIds.delete(source.id);
    }
  });

  return { due: due.length, polled: batch.length, skippedInFlight };
}

const DEFAULT_TICK_INTERVAL_MS = 30_000;

/** Runtime state for the health endpoint and any other observability consumer — deliberately just
 * timestamps, the last result shape, and a short sanitized error message, never source names/URLs/DB
 * detail. Kept on globalThis, same as the __vigilScheduler start-guard below, so it survives a dev-mode
 * hot reload and is visible from any module that imports this file. */
export interface SchedulerState {
  startedAt: string | null;
  lastTickStartedAt: string | null;
  lastTickFinishedAt: string | null;
  lastTickResult: SchedulerTickResult | null;
  lastTickError: string | null;
}
const g = globalThis as unknown as { __vigilScheduler?: boolean; __vigilSchedulerState?: SchedulerState };
function state(): SchedulerState {
  return (g.__vigilSchedulerState ??= { startedAt: null, lastTickStartedAt: null, lastTickFinishedAt: null, lastTickResult: null, lastTickError: null });
}
export function getSchedulerState(): SchedulerState {
  return { ...state() };
}
// A raw error's own .message can be verbose (and, for some driver errors, includes query text); cap it
// hard and never touch .stack, so a sanitized-looking field can never accidentally leak detail.
const sanitizeError = (err: unknown): string => (err instanceof Error ? err.message : String(err)).slice(0, 200);

/** Starts the server-side scheduler loop once per server process. Guarded
 * by a global flag the same way lib/db/client.ts guards the PrismaClient
 * singleton, so a dev-mode hot reload never stacks up duplicate intervals.
 * Called from instrumentation.ts on server startup. The tick itself runs
 * far more often than any source's actual poll interval (default 5min for
 * RSS) — it's cheap (one indexed query when nothing is due) and is what
 * lets each source's own interval/backoff take effect promptly. */
export function startScheduler(tickIntervalMs = DEFAULT_TICK_INTERVAL_MS) {
  if (g.__vigilScheduler) return;
  g.__vigilScheduler = true;
  state().startedAt = new Date().toISOString();

  console.log(`[ingestion] scheduler started (tick every ${tickIntervalMs}ms)`);
  // Ticks never overlap: a slow pass (many due sources, slow feeds) is allowed to finish before the next starts.
  let running = false;
  const tick = () => {
    if (running) return;
    running = true;
    state().lastTickStartedAt = new Date().toISOString();
    schedulerTick()
      .then((result) => {
        state().lastTickResult = result;
        state().lastTickError = null;
        if (result.polled > 0) console.log(`[ingestion] scheduler tick: ${result.polled}/${result.due} due source(s) polled${result.skippedInFlight ? `, ${result.skippedInFlight} already in flight` : ""}`);
      })
      .catch((err) => {
        state().lastTickError = sanitizeError(err);
        console.error("[ingestion] scheduler tick failed:", err);
      })
      .finally(() => {
        state().lastTickFinishedAt = new Date().toISOString();
        running = false;
      });
  };
  tick();
  setInterval(tick, tickIntervalMs);
}
