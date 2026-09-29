// Canonical deterministic E2E entry point. Each Playwright project (Desktop, Mobile) gets its own fresh
// test DB: playwright.config.ts's webServer already rebuilds prisma/test.db from scratch (migrate +
// seed) on every `npx playwright test` process it starts, and does so once per invocation, shared across
// every project that invocation selects. Desktop and Mobile used to run inside ONE invocation and so
// inherited each other's fixture rows for the whole ~1 hour run; running them as two SEPARATE, sequential
// invocations (never parallel — that would mean two Next dev servers racing on the same TEST_PORT and two
// processes writing the same test.db file) gives each project a genuinely clean, isolated starting state
// with no config changes beyond selecting one project per invocation.
//
// The "Live" project (tests tagged *.live.spec.ts, e.g. the real-BBC-feed smoke test) is intentionally
// NOT run here — see `npm run test:live`.
import { spawnSync } from "node:child_process";

const projects = ["Desktop", "Mobile"];
const results = [];

for (const project of projects) {
  console.log(`\n=== Playwright project: ${project} (fresh test DB) ===\n`);
  const r = spawnSync("npx", ["playwright", "test", `--project=${project}`], { stdio: "inherit", shell: true });
  results.push({ project, status: r.status ?? 1 });
}

console.log("\n=== test:e2e summary ===");
for (const { project, status } of results) console.log(`${project}: ${status === 0 ? "passed" : `FAILED (exit ${status})`}`);

process.exit(results.some((r) => r.status !== 0) ? 1 : 0);
