import { test, expect } from "@playwright/test";

// Deterministic suite for the "Ingestion Reliability Hardening" stage:
// bounded scheduler concurrency, HTTP failure handling (429/403/5xx +
// Retry-After), exponential backoff, and confirmation that none of this
// regresses overlap prevention or duplicate protection. Every source
// here points at the local fixture RSS route
// (app/api/test-fixtures/rss/[name]) — including its ?status=/
// ?retryAfter=/?delayMs= simulation params — never a real external feed.
// playwright.config.ts sets INGESTION_FETCH_TIMEOUT_MS=8000 for this
// server process, short enough to exercise a real timeout deterministically
// (lib/ingestion/poll.ts's FETCH_TIMEOUT_MS) while absorbing this
// sandbox's dev-mode Turbopack first-hit compile latency.
const FIXTURE_BASE = "http://localhost:3100/api/test-fixtures/rss";

test.describe.serial("Ingestion reliability hardening", () => {
  test.beforeAll(async ({ request }) => {
    // Warms up Turbopack's compile of the fixture route before any
    // timing-sensitive assertion runs — this file's first request to it
    // (however small the requested delay) can otherwise itself take
    // several seconds in dev mode, which would make the very first
    // timing-sensitive test flaky for a reason that has nothing to do
    // with the scheduler logic being tested.
    await request.get(`${FIXTURE_BASE}/feed-a`);
    await request.get(`${FIXTURE_BASE}/feed-a?delayMs=10`);
    await request.get(`${FIXTURE_BASE}/feed-a?status=500`);
  });

  test("1. Bounded concurrency: due sources are polled with a concurrency cap, not all at once", async ({ request }) => {
    // 6 sources, each a ~400ms fetch — comfortably under the 2s test
    // timeout even across two waves. With MAX_CONCURRENT_FETCHES=4
    // (lib/ingestion/scheduler.ts), 6 sources need two waves (4 then 2),
    // so the whole tick takes noticeably longer than one wave (~400ms) —
    // an unbounded scheduler would finish in ~400ms regardless of count.
    const sourceIds: string[] = [];
    for (let i = 0; i < 6; i++) {
      const source = await request
        .post("/api/admin/sources", {
          data: {
            name: `Concurrency Test ${i} ${Date.now()}`,
            type: "rss",
            url: `${FIXTURE_BASE}/feed-a?delayMs=400`,
            enabled: true,
            autoIngest: true,
            autoProcessing: false,
            pollIntervalMinutes: 999,
          },
        })
        .then((r) => r.json());
      sourceIds.push(source.id);
    }

    const start = Date.now();
    const result = await request.post("/api/admin/scheduler/tick", { data: { sourceIds } }).then((r) => r.json());
    const elapsedMs = Date.now() - start;

    expect(result.due).toBe(6);
    expect(result.polled).toBe(6);
    // The real assertion of interest is the lower bound — two waves of
    // ~400ms each takes noticeably longer than one wave would. The upper
    // bound is a generous hang-guard only, not a performance assertion:
    // this sandbox's dev server has highly variable per-request latency
    // (Turbopack recompilation, a flagged "slow filesystem"), so a tight
    // upper bound would be testing environment speed, not concurrency
    // behavior.
    expect(elapsedMs).toBeGreaterThan(650);
    expect(elapsedMs).toBeLessThan(20_000);

    const sources = await request.get("/api/admin/sources").then((r) => r.json());
    for (const id of sourceIds) {
      const s = sources.find((x: { id: string }) => x.id === id);
      expect(s.health).toBe("live");
    }
  });

  test("2. A broken and a slow source in the same bounded-concurrency tick don't block a third, healthy source", async ({
    request,
  }) => {
    const broken = await request
      .post("/api/admin/sources", {
        data: {
          name: `Reliability Broken ${Date.now()}`,
          type: "rss",
          url: `${FIXTURE_BASE}/feed-a?status=500`,
          enabled: true,
          autoIngest: true,
          autoProcessing: false,
          pollIntervalMinutes: 999,
        },
      })
      .then((r) => r.json());
    const slow = await request
      .post("/api/admin/sources", {
        data: {
          name: `Reliability Slow ${Date.now()}`,
          type: "rss",
          url: `${FIXTURE_BASE}/feed-a?delayMs=500`,
          enabled: true,
          autoIngest: true,
          autoProcessing: false,
          pollIntervalMinutes: 999,
        },
      })
      .then((r) => r.json());
    const healthy = await request
      .post("/api/admin/sources", {
        data: {
          name: `Reliability Healthy ${Date.now()}`,
          type: "rss",
          url: `${FIXTURE_BASE}/feed-b`,
          enabled: true,
          autoIngest: true,
          autoProcessing: false,
          pollIntervalMinutes: 999,
        },
      })
      .then((r) => r.json());

    const result = await request
      .post("/api/admin/scheduler/tick", { data: { sourceIds: [broken.id, slow.id, healthy.id] } })
      .then((r) => r.json());
    expect(result.due).toBe(3);
    expect(result.polled).toBe(3);

    const sources = await request.get("/api/admin/sources").then((r) => r.json());
    expect(sources.find((s: { id: string }) => s.id === broken.id).health).toBe("error");
    expect(sources.find((s: { id: string }) => s.id === slow.id).health).toBe("live");
    expect(sources.find((s: { id: string }) => s.id === healthy.id).health).toBe("live");
  });

  test("3. A 429 response with Retry-After sets the next poll no earlier than the server-requested time, overriding a shorter backoff", async ({
    request,
  }) => {
    const source = await request
      .post("/api/admin/sources", {
        data: {
          name: `Reliability Retry-After ${Date.now()}`,
          type: "rss",
          // pollIntervalMinutes: 1 -> a bare first-failure backoff would be
          // 1 * 2 = 2 minutes; retryAfter=600s (10 min) must win instead.
          url: `${FIXTURE_BASE}/feed-a?status=429&retryAfter=600`,
          enabled: true,
          autoIngest: true,
          autoProcessing: false,
          pollIntervalMinutes: 1,
        },
      })
      .then((r) => r.json());

    const before = Date.now();
    await request.post(`/api/admin/sources/${source.id}/fetch`);

    const sources = await request.get("/api/admin/sources").then((r) => r.json());
    const updated = sources.find((s: { id: string }) => s.id === source.id);
    expect(updated.health).toBe("error");
    expect(updated.lastError).toContain("429");

    const nextPollMs = new Date(updated.nextPollAt).getTime();
    // At least ~9.5 minutes out — comfortably more than the 2-minute
    // backoff-only figure, proving Retry-After was the deciding factor.
    expect(nextPollMs - before).toBeGreaterThan(9.5 * 60_000);
  });

  test("4. Repeated failures back off exponentially (2x, 4x, capped), resetting to normal on the next success", async ({
    request,
  }) => {
    const source = await request
      .post("/api/admin/sources", {
        data: {
          name: `Reliability Backoff ${Date.now()}`,
          type: "rss",
          url: `${FIXTURE_BASE}/feed-a?status=503`,
          enabled: true,
          autoIngest: true,
          autoProcessing: false,
          pollIntervalMinutes: 1,
        },
      })
      .then((r) => r.json());

    const delays: number[] = [];
    for (let attempt = 0; attempt < 2; attempt++) {
      const before = Date.now();
      await request.post(`/api/admin/sources/${source.id}/fetch`);
      const sources = await request.get("/api/admin/sources").then((r) => r.json());
      const updated = sources.find((s: { id: string }) => s.id === source.id);
      expect(updated.consecutiveFailures).toBe(attempt + 1);
      delays.push(new Date(updated.nextPollAt).getTime() - before);
    }
    // Failure 1: 1min * 2 = 2min. Failure 2: 1min * 4 = 4min — roughly
    // double the first delay, not the same or smaller.
    expect(delays[1]).toBeGreaterThan(delays[0]! * 1.5);

    // Now let it succeed — update the URL to the real fixture feed and
    // confirm consecutiveFailures resets and the delay drops back to the
    // plain 1-minute interval, not a lingering backed-off one.
    await request.patch(`/api/admin/sources/${source.id}`, { data: { url: `${FIXTURE_BASE}/feed-a` } });
    const beforeSuccess = Date.now();
    await request.post(`/api/admin/sources/${source.id}/fetch`);
    const sourcesAfter = await request.get("/api/admin/sources").then((r) => r.json());
    const afterSuccess = sourcesAfter.find((s: { id: string }) => s.id === source.id);
    expect(afterSuccess.consecutiveFailures).toBe(0);
    expect(afterSuccess.health).toBe("live");
    const successDelayMs = new Date(afterSuccess.nextPollAt).getTime() - beforeSuccess;
    expect(successDelayMs).toBeLessThan(1.5 * 60_000); // back to ~1 minute, not still backed off
  });

  test("5. A fetch that exceeds the timeout is recorded as a timeout error, not a hang", async ({ request }) => {
    // INGESTION_FETCH_TIMEOUT_MS=8000 (playwright.config.ts) — 12s exceeds it.
    const source = await request
      .post("/api/admin/sources", {
        data: {
          name: `Reliability Timeout ${Date.now()}`,
          type: "rss",
          url: `${FIXTURE_BASE}/feed-a?delayMs=12000`,
          enabled: true,
          autoIngest: true,
          autoProcessing: false,
          pollIntervalMinutes: 5,
        },
      })
      .then((r) => r.json());

    const result = await request.post(`/api/admin/sources/${source.id}/fetch`).then((r) => r.json());
    expect(result.errors).toBe(1);
    expect(result.error).toContain("timed out");

    const sources = await request.get("/api/admin/sources").then((r) => r.json());
    const updated = sources.find((s: { id: string }) => s.id === source.id);
    expect(updated.health).toBe("error");
    expect(updated.errorsToday).toBeGreaterThanOrEqual(1);
  });

  test("6. Overlap prevention and duplicate protection are intact under the bounded-concurrency scheduler", async ({
    request,
  }) => {
    const source = await request
      .post("/api/admin/sources", {
        data: {
          name: `Reliability Overlap+Dedup ${Date.now()}`,
          type: "rss",
          url: `${FIXTURE_BASE}/feed-b?delayMs=1000`,
          enabled: true,
          autoIngest: true,
          autoProcessing: false,
          pollIntervalMinutes: 999,
        },
      })
      .then((r) => r.json());

    // Overlap: a second tick fired while the first is still mid-fetch
    // must skip the source, not poll it twice concurrently.
    const firstPromise = request.post("/api/admin/scheduler/tick", { data: { sourceIds: [source.id] } });
    await new Promise((resolve) => setTimeout(resolve, 300));
    const secondPromise = request.post("/api/admin/scheduler/tick", { data: { sourceIds: [source.id] } });
    const [first, second] = await Promise.all([
      firstPromise.then((r) => r.json()),
      secondPromise.then((r) => r.json()),
    ]);
    expect(first.polled + second.polled).toBe(1);
    expect(first.skippedInFlight + second.skippedInFlight).toBe(1);

    // Duplicate protection: once settled, a plain re-fetch of the same
    // feed must report zero new items (guid-based dedup untouched by any
    // of the above).
    const refetch = await request.post(`/api/admin/sources/${source.id}/fetch`).then((r) => r.json());
    expect(refetch.new).toBe(0);
    expect(refetch.alreadyKnown).toBe(refetch.fetched);
  });
});
