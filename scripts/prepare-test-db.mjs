// Builds a fresh, disposable SQLite DB for the Playwright suite: migrated and
// seeded exactly like a new dev DB, but at prisma/test.db — never dev.db.
// Run by playwright.config.ts's webServer command before the test server
// starts, so every suite run begins from a known state and nothing the tests
// create can ever reach the normal dev database.
import { rmSync } from "node:fs";
import { spawnSync } from "node:child_process";

const url = process.env.DATABASE_URL;
if (!url || !/test\.db$/.test(url)) {
  console.error(`Refusing to reset a non-test database (DATABASE_URL=${url}).`);
  process.exit(1);
}
const file = url.replace(/^file:/, "");
for (const suffix of ["", "-journal", "-wal", "-shm"]) rmSync(`${file}${suffix}`, { force: true });

for (const args of [["prisma", "migrate", "deploy"]]) {
  const r = spawnSync("npx", args, { stdio: "inherit", shell: true, env: process.env });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
const seed = spawnSync("node", ["prisma/seed.mjs"], { stdio: "inherit", shell: true, env: process.env });
process.exit(seed.status ?? 1);
