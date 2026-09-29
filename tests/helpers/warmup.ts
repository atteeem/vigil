import type { Page } from "@playwright/test";

// Next.js dev mode (Turbopack) compiles a route's client JS bundle on its first real hit — the SSR'd HTML
// for that first request already looks fully interactive (e.g. a button's data-following="false" is
// already in the markup), but hydration (attaching onClick handlers) can still be mid-compile behind it.
// An automated click fires essentially the instant the target appears, unlike a human's naturally slower
// pace, so it can land in that gap and silently do nothing. This is unrelated to test-DB state/isolation —
// it reproduces on a route's first hit in a run regardless of how clean the DB is — so navigating once to
// force the compile, then again for the real test, removes the race without waiting an arbitrary amount.

/** Navigates to `path` twice, discarding the first hit, so the route's client bundle is already compiled
 * and hydrated by the time the real, timing-sensitive interaction begins. */
export async function warmRoute(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.goto(path);
}
