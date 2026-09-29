import type { TestInfo } from "@playwright/test";

// A test that creates its own Source/RawIngestionItem/etc. still needs those rows to be identifiable and
// non-colliding — but with each Playwright project now running against its own fresh test DB
// (scripts/test-e2e.mjs), the only remaining collision risk is between DIFFERENT spec files in the SAME
// project run, not between projects. A per-test, per-project namespace is enough for that and is
// deterministic (unlike Date.now()/Math.random()), so a failure reproduces identically on every run.

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/** Stable identity for one fixture entity this test owns, e.g. fixtureId(testInfo, "source-a"). */
export function fixtureId(testInfo: TestInfo, label: string): string {
  return `${slugify(testInfo.project.name)}-${slugify(testInfo.title).slice(0, 60)}-${slugify(label)}`;
}

/** A fixture:// URL built from fixtureId — for tests that just need a stable, unique-enough URL. */
export function fixtureUrl(testInfo: TestInfo, label: string): string {
  return `https://fixture.test/${fixtureId(testInfo, label)}`;
}
