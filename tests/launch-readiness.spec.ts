import { test, expect, type Page } from "@playwright/test";
import { SCORE_COPY, SOURCE_CLASS_COPY, IMPACT_COUNTRY_COPY } from "@/lib/copy/scores";

// Launch readiness / first-user experience: the first-run introduction and impact-country question, the map legend,
// one wording for the three scores, Watch confirmation, For You empty state, the source-label explanation, the LIVE
// freshness badge, error states and the not-found page.

test.describe.configure({ timeout: 150_000 });

const EMPTY_STATE = { cookies: [], origins: [] };
const onboarding = (page: Page) => page.evaluate(() => localStorage.getItem("vigil.onboarding"));

test.describe("First visit", () => {
  test.use({ storageState: EMPTY_STATE });

  test("four-step introduction with Back / Next / Done, then the impact-country question; completion persists", async ({ page }) => {
    await page.goto("/");
    const dialog = page.getByTestId("onboarding");
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute("aria-modal", "true");
    const titles: string[] = [];
    for (let i = 0; i < 3; i++) {
      titles.push((await page.getByTestId("onboarding-step-title").innerText()).trim());
      await page.getByTestId("onboarding-next").click();
    }
    titles.push((await page.getByTestId("onboarding-step-title").innerText()).trim());
    expect(titles).toEqual(["Global intelligence", "Three different scores", "Source-backed", "Personalize"]);
    await page.getByTestId("onboarding-back").click();
    await expect(page.getByTestId("onboarding-step-title")).toHaveText("Source-backed");
    await page.getByTestId("onboarding-next").click();
    await page.getByTestId("onboarding-done").click();
    await expect(dialog).toHaveCount(0);

    // Asked once: the impact country. Search resolves aliases; choosing sets the impact country.
    const prompt = page.getByTestId("impact-country-prompt");
    await expect(prompt).toContainText(IMPACT_COUNTRY_COPY.question);
    await expect(prompt).toContainText(IMPACT_COUNTRY_COPY.explain);
    await page.getByTestId("impact-country-input").fill("Sweden");
    await page.getByTestId("impact-country-option").first().click();
    await expect(prompt).toHaveCount(0);
    expect(JSON.parse((await page.evaluate(() => localStorage.getItem("vigil-preferences")))!).state.baseCountryCode).toBe("SE");
    expect(JSON.parse((await onboarding(page))!)).toEqual({ introDone: true, countryAsked: true });

    // Persistence: nothing is asked again after a reload or on another page.
    await page.reload();
    await page.goto("/conflicts");
    await expect(page.getByTestId("conflict-grid")).toBeVisible();
    await expect(page.getByTestId("onboarding")).toHaveCount(0);
    await expect(page.getByTestId("impact-country-prompt")).toHaveCount(0);
  });

  test("the three scores step uses the canonical wording; Skip and Escape both finish", async ({ page }) => {
    await page.goto("/conflicts");
    await page.getByTestId("onboarding-next").click();
    for (const k of ["severity", "impact", "confidence"] as const) await expect(page.getByTestId("onboarding")).toContainText(SCORE_COPY[k].question);
    await page.getByTestId("onboarding-skip").click();
    await expect(page.getByTestId("onboarding")).toHaveCount(0);
    await page.keyboard.press("Escape"); // skips the country question; the default stays
    await expect(page.getByTestId("impact-country-prompt")).toHaveCount(0);
    expect(JSON.parse((await onboarding(page))!)).toEqual({ introDone: true, countryAsked: true });
  });

  test("Settings → Help → Show introduction again", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("vigil.onboarding", JSON.stringify({ introDone: true, countryAsked: true })));
    await page.goto("/profile");
    await expect(page.getByTestId("onboarding")).toHaveCount(0);
    await page.getByTestId("show-introduction").click();
    await expect(page.getByTestId("onboarding")).toBeVisible();
    await expect(page.getByTestId("onboarding-progress")).toContainText("1 of 4");
  });
});

test.describe("Settings", () => {
  test("sections, impact country, sources explanation, methodology link; no dead controls", async ({ page }) => {
    await page.goto("/profile");
    for (const id of ["settings-general", "settings-impact-country", "sources-settings", "settings-notifications", "settings-map", "settings-privacy", "settings-help"]) await expect(page.getByTestId(id)).toBeAttached();
    await expect(page.getByTestId("settings-impact-country")).toContainText(IMPACT_COUNTRY_COPY.explain);
    await expect(page.getByTestId("sources-settings").getByTestId("source-trust-help")).toContainText("Party / Aligned Claim does NOT mean false");
    await expect(page.getByTestId("settings-methodology")).toHaveAttribute("href", "/methodology");
    await expect(page.getByRole("radiogroup", { name: "Theme" })).toHaveCount(0);
    await expect(page.getByText("Preferred regions")).toHaveCount(0);
    await expect(page.getByText("coming later")).toHaveCount(0);
    await page.getByTestId("reduced-motion").check();
    expect(JSON.parse((await page.evaluate(() => localStorage.getItem("vigil-preferences")))!).state.contentSensitivity).toBe("reduced");
  });
});

test.describe("Scores, sources and methodology", () => {
  test("conflict page states each score's question in the canonical words", async ({ page }) => {
    await page.goto("/conflict/russia-ukraine");
    await expect(page.getByTestId("score-severity-question")).toHaveText(SCORE_COPY.severity.question);
    await expect(page.getByTestId("score-impact-question")).toHaveText(SCORE_COPY.impact.question);
    await expect(page.getByTestId("score-confidence-question")).toHaveText(SCORE_COPY.confidence.question);
  });

  test("methodology explains the pipeline, the three scores, source classes and territory terms", async ({ page }) => {
    await page.goto("/methodology");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("How Vigil works");
    for (const k of ["severity", "impact", "confidence"] as const) await expect(page.getByTestId(`methodology-score-${k}`)).toContainText(SCORE_COPY[k].question);
    for (const c of SOURCE_CLASS_COPY) await expect(page.getByTestId("source-trust-help")).toContainText(c.label);
    await expect(page.locator("#territory")).toContainText("not legal sovereignty");
    await expect(page.locator("#pipeline")).toContainText("Report → Event → Conflict");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  });
});

test.describe("Map legend", () => {
  test("compact, dismissible, and uses the territory terminology", async ({ page, isMobile }) => {
    await page.goto("/world");
    await page.getByTestId("map-legend-button").click();
    const content = page.getByTestId("map-legend-content");
    await expect(content).toBeVisible();
    for (const term of ["Heatmap", "Report markers", "Territorial control", "Contested", "Influence", "Presence", "Confidence"]) await expect(content).toContainText(term);
    await expect(content).toContainText("Not legal sovereignty");
    await expect(content).toContainText("unique published reports");
    if (isMobile) await page.getByRole("button", { name: "Close sheet" }).click();
    else await page.getByRole("button", { name: "Close legend" }).click();
    await expect(content).toHaveCount(0);
  });
});

test.describe("Watch and For You", () => {
  test("Watch shows a confirmation that only promises existing features", async ({ page }) => {
    await page.goto("/country/FI");
    const watch = page.locator('[data-testid="follow-button"]:visible').first();
    await expect(watch).toHaveAttribute("data-following", "false");
    await watch.click();
    const note = page.getByTestId("watch-confirmation").first();
    await expect(note).toContainText("Watching Finland");
    await expect(note).toContainText("Important developments will appear in For You and Notifications.");
  });

  test("For You empty state offers Search, Browse conflicts and Open World Map", async ({ page }) => {
    await page.goto("/for-you");
    const empty = page.getByTestId("for-you-no-watches");
    await expect(empty).toContainText("Watch countries, conflicts or actors to build your intelligence feed.");
    await expect(page.getByTestId("for-you-action-conflicts")).toHaveAttribute("href", "/conflicts");
    await expect(page.getByTestId("for-you-action-map")).toHaveAttribute("href", "/world");
    await page.getByTestId("for-you-action-search").click();
    await expect(page.getByTestId("search-dialog")).toBeVisible();
  });

  test("evidence sections explain source labels (Party / Aligned Claim is not 'false')", async ({ page }) => {
    await page.goto("/conflict/russia-ukraine");
    const toggle = page.getByTestId("feed-evidence-toggle").first();
    test.skip((await toggle.count()) === 0, "no development with reports in this database");
    await toggle.click();
    await page.getByTestId("feed-evidence").first().getByTestId("source-trust-toggle").click();
    await expect(page.getByTestId("feed-evidence").first().getByTestId("source-trust-help")).toContainText("does NOT mean false");
  });
});

test.describe("Freshness, errors and not found", () => {
  test("the header badge follows real ingestion freshness", async ({ page, request, isMobile }) => {
    const f = (await request.get("/api/status/freshness").then((r) => r.json())) as { state: string; label: string };
    expect(["live", "delayed", "stale", "no-data"]).toContain(f.state);
    await page.goto("/conflicts");
    const badge = page.locator('[data-testid="global-live-indicator"]:visible');
    await expect(badge).toHaveAttribute("data-live-state", f.state);
    await expect(badge).toHaveText(f.label);
    // A failed check never claims LIVE.
    await page.route("**/api/status/freshness", (r) => r.fulfill({ status: 500, body: "" }));
    await page.reload();
    await expect(page.locator('[data-testid="global-live-indicator"]:visible')).not.toHaveText("LIVE");
    // /world shows it once (desktop: in its status bar).
    await page.unroute("**/api/status/freshness");
    await page.goto("/world");
    if (!isMobile) await expect(page.locator('[data-testid="global-live-indicator"]:visible')).toHaveCount(0);
  });

  test("unknown country / conflict / actor / address: a useful not-found page, no framework error", async ({ page }) => {
    for (const path of ["/country/ZZ", "/conflict/no-such-conflict", "/actor/no-such-actor", "/unit/no-such-unit", "/no-such-page"]) {
      const res = await page.goto(path);
      expect(res?.status(), path).toBe(404);
      await expect(page.getByTestId("not-found")).toBeVisible();
      await expect(page.getByTestId("recovery-conflicts")).toHaveAttribute("href", "/conflicts");
      await expect(page.getByTestId("recovery-map")).toHaveAttribute("href", "/world");
      expect(await page.locator("body").innerText()).not.toMatch(/This page could not be found|Error:|at .*\.tsx/);
    }
    await page.getByTestId("recovery-search").click();
    await expect(page.getByTestId("search-dialog")).toBeVisible();
  });

  test("search unavailable: an explicit message with retry, not an empty list", async ({ page }) => {
    await page.route("**/api/public/search**", (r) => r.fulfill({ status: 500, body: "" }));
    await page.goto("/conflicts");
    await page.locator('[data-testid="header-search"]:visible, [data-testid="mobile-search"]:visible').first().click();
    await page.getByTestId("search-input").fill("Finland");
    await expect(page.getByTestId("search-error")).toContainText("Search is unavailable right now.");
    await expect(page.getByTestId("search-empty")).toHaveCount(0);
    await page.unroute("**/api/public/search**");
    await page.getByTestId("search-error").getByRole("button", { name: "Try again" }).click();
    await expect(page.getByTestId("search-group-countries")).toBeVisible();
  });

  test("map data unavailable: /world keeps the map and says so with a retry", async ({ page }) => {
    await page.route("**/api/events", (r) => r.fulfill({ status: 503, body: "" }));
    await page.goto("/world");
    await expect(page.getByTestId("map-data-error")).toBeVisible();
    await expect(page.locator("canvas.maplibregl-canvas")).toBeVisible();
  });

  test("search shows why an alias matched", async ({ page }) => {
    await page.goto("/conflicts");
    await page.locator('[data-testid="header-search"]:visible, [data-testid="mobile-search"]:visible').first().click();
    await page.getByTestId("search-input").fill("Suomi");
    await expect(page.getByTestId("search-group-countries").getByTestId("search-result-matched").first()).toHaveText("Alias: Suomi");
  });
});
