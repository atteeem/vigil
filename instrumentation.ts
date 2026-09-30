// Next.js server-startup hook (runs once per server process, both `next
// dev` and `next start`). Used to start the local-development
// source-ingestion scheduler — see lib/ingestion/scheduler.ts — and to fix
// a real multi-source-ingestion reliability bug found while testing this
// milestone's new RSS sources: several legitimate, working feeds
// (who.int, gdacs.org) reliably failed with Node's fetch() specifically
// (10s ConnectTimeoutError) while curl against the exact same URL at the
// exact same time succeeded in under a second. Root cause: Node's default
// DNS result ordering tries an IPv6 address first, which is unreachable
// from this environment — every request to a dual-stack host burns the
// full connect timeout before Node would otherwise fall back. Forcing
// IPv4-first resolution (a documented Node API for exactly this failure
// mode, not a per-host workaround) fixed every affected feed immediately.
export async function register() {
  // Startup diagnostics only — never logs an env VALUE, only which runtime this is and which named
  // toggles are set (as booleans), so this is safe to leave on in any deployment's logs.
  console.log(`[instrumentation] register() called, NEXT_RUNTIME=${process.env.NEXT_RUNTIME ?? "(unset)"}`);

  if (process.env.NEXT_RUNTIME === "nodejs") {
    const dns = await import("node:dns");
    dns.setDefaultResultOrder("ipv4first");

    // DISABLE_BACKGROUND_SCHEDULER=true — set in playwright.config.ts's
    // webServer.env for the deterministic suite. Without this, the real
    // background loop polls every enabled+auto-ingest source (including
    // tests/multi-source-ingestion.spec.ts's own test-scoped sources)
    // concurrently with tests' explicit, scoped POST
    // /api/admin/scheduler/tick calls — an ambient tick can land mid-test
    // and "use up" a source's due/in-flight state before the test's own
    // assertion runs, which is exactly the kind of nondeterminism this
    // suite exists to avoid. Real local dev (no this env var) still gets
    // the live background scheduler as normal.
    const disabled = process.env.DISABLE_BACKGROUND_SCHEDULER === "true" || process.env.DISABLE_INGESTION_SCHEDULER === "1";
    console.log(`[instrumentation] scheduler startup ${disabled ? "DISABLED" : "enabled"} (DISABLE_BACKGROUND_SCHEDULER=${process.env.DISABLE_BACKGROUND_SCHEDULER === "true"}, DISABLE_INGESTION_SCHEDULER=${process.env.DISABLE_INGESTION_SCHEDULER === "1"})`);
    if (!disabled) {
      const { startScheduler } = await import("@/lib/ingestion/scheduler");
      const tickIntervalMs = Number(process.env.SCHEDULER_TICK_INTERVAL_MS) || 30_000;
      startScheduler(tickIntervalMs);
    }
  }
}
