import { defineConfig, devices } from "@playwright/test";

// Local-development E2E suite (spec §20). Tests create whatever fixture data
// they need via the API and avoid asserting on total counts.
// Test isolation: the suite runs its own Next server on its own port, its own
// build dir and its own throwaway SQLite DB (rebuilt from migrations + seed
// by scripts/prepare-test-db.mjs on every run). Fixture actors, territories,
// events and sources therefore can never appear in the normal dev DB/UI.
// Setting DATABASE_URL here also covers tests that import the Prisma client
// directly (they run in workers that inherit this process.env).
const TEST_PORT = 3100;
const TEST_DB_URL = "file:./prisma/test.db";
process.env.DATABASE_URL = TEST_DB_URL;

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${TEST_PORT}`,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "Desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "Mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: `node scripts/prepare-test-db.mjs && npx next dev -p ${TEST_PORT}`,
    url: `http://localhost:${TEST_PORT}`,
    // Never attach to an already-running (dev-DB) server.
    reuseExistingServer: false,
    timeout: 900_000, // includes rebuilding + seeding the test DB before the server starts
    env: {
      DATABASE_URL: TEST_DB_URL,
      NEXT_DIST_DIR: ".next-test",
      // Fixture Telegram channels for the credential-gated adapter (test server only).
      TELEGRAM_FIXTURES: "true",
      TEST_FIXTURES: "true",
      // The dev machine may have a MapTiler key in .env; tests run key-less so the bundled/PMTiles basemap paths are what is exercised.
      NEXT_PUBLIC_MAPTILER_KEY: "",
      // Optional RSSHub sidecar (docs/RSSHUB_INTEGRATION.md): in tests it points at the local RSS fixture route, so
      // `rsshub://feed-a` resolves to a real same-origin feed and exercises the normal RSSAdapter path.
      RSSHUB_BASE_URL: "http://localhost:3100/api/test-fixtures/rss",
      // Fixture-only credentials so the credentialed FAA NOTAM adapter can be exercised against local
      // fixtures; CLOUDFLARE_RADAR_TOKEN is deliberately left unset (the "not configured" path).
      FAA_NOTAM_CLIENT_ID: "fixture-client",
      FAA_NOTAM_CLIENT_SECRET: "fixture-secret",
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
