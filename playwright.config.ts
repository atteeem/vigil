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
  },
});
