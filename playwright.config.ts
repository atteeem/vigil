import { defineConfig, devices } from "@playwright/test";

// Local-development E2E suite (spec §20). Assumes the SQLite DB has been
// migrated (`npm run db:migrate`) — it does not seed/reset the DB itself,
// so tests create whatever fixture data they need via the API and avoid
// asserting on total counts that other data could affect.
export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "Desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "Mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 60_000,
    env: {
      // Forces the gazetteer-only geocoding provider (no live Nominatim
      // calls) so /api/admin/geocode is deterministic too — see
      // lib/geocoding/provider.ts.
      GEOCODING_PROVIDER: "fixture",
      // Keeps the real background scheduler out of the test process — see
      // instrumentation.ts's comment. Tests drive polling explicitly via
      // POST /api/admin/scheduler/tick instead.
      DISABLE_BACKGROUND_SCHEDULER: "true",
      // Short enough that tests/ingestion-reliability.spec.ts's timeout
      // test sees a real timeout in seconds instead of the real 20s
      // default, but generous enough to absorb this sandbox's dev-mode
      // Turbopack first-hit compile latency on a freshly-edited route
      // (observed: a route's very first request after an edit can itself
      // take several seconds) — see lib/ingestion/poll.ts's
      // FETCH_TIMEOUT_MS and that spec's warm-up request.
      INGESTION_FETCH_TIMEOUT_MS: "8000",
    },
  },
});
