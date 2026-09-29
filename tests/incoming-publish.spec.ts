import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { prisma } from "@/lib/db/client";
import { runBulkPublish } from "@/lib/ingestion/bulk-publish";
import { filtersFromParams } from "@/lib/ingestion/incoming-queue";

// Incoming Reports: the per-report Publish, "Publish filtered" / "Publish selected" with confirmation and summary,
// through the one publish path, with hierarchical location (country-level news needs no coordinates) and the original
// source link preserved. Each test uses its own source so the filters select exactly its own reports.

const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

async function makeSource(request: APIRequestContext, label: string) {
  const res = await request.post("/api/admin/sources", { data: { name: `Publish ${label} ${uid()}`, type: "manual", autoProcessing: true } });
  expect(res.ok()).toBeTruthy();
  return (await res.json()) as { id: string; name: string };
}
async function addReport(request: APIRequestContext, sourceId: string, title: string, text: string) {
  const url = `https://news.example-source.test/${uid()}`; // a stored URL that must come back unchanged
  const res = await request.post("/api/admin/incoming/manual", { data: { sourceId, originalTitle: title, originalText: text, originalUrl: url } });
  expect(res.ok()).toBeTruthy();
  return { ...((await res.json()) as { id: string }), url };
}
const bulk = (request: APIRequestContext, sourceId: string, body: Record<string, unknown>) =>
  request.post("/api/admin/incoming/publish-bulk", { data: { filters: `status=pending&sourceId=${sourceId}`, ...body } });

test.describe("Publish filtered (API)", () => {
  test("publishes exactly the filtered reports: country-level news without coordinates, region and city with their precision, original URLs kept", async ({ request }) => {
    const mine = await makeSource(request, "A");
    const other = await makeSource(request, "B");
    // Region/city examples deliberately avoid Russia-Ukraine (Kyiv/Kharkiv/Odesa/Sumy/Kherson): it is by
    // far the most fixture-saturated conflict across this whole suite, so a generic same-day kinetic
    // report there routinely scores "high" duplicate likelihood against some OTHER spec's leftover event
    // and gets conservatively held for review — exactly the correct, intended behavior (§1: an ambiguous
    // candidate stays for human review), but not what this test is trying to isolate (location-scope
    // precision handling). Sudan is a real tracked conflict too but far less saturated in practice.
    const country = await addReport(request, mine.id, `Libya central bank names a new governor ${uid()}`, "The appointment follows a dispute over the bank's leadership. Officials gave no date.");
    const region = await addReport(request, mine.id, `Aid convoy delayed entering North Darfur ${uid()}`, "Regional authorities urged residents to use shelters.");
    const city = await addReport(request, mine.id, `Shelling reported near El Fasher ${uid()}`, "Local officials reported damage to several buildings.");
    const outsider = await addReport(request, other.id, `Libya parliament debates budget ${uid()}`, "Lawmakers met on Sunday.");
    // Both region/city Sudan reports still default to "now", so Desktop's and Mobile's own runs of this
    // SAME test (moments apart, same conflict/region/type) can otherwise collide with each other exactly
    // like a different project's leftover event — a random multi-year backdate (this test asserts nothing
    // about relative "X ago" display) keeps them apart without affecting any location-precision assertion.
    for (const r of [region, city]) {
      await prisma.rawIngestionItem.update({ where: { id: r.id }, data: { publishedAt: new Date(Date.now() - Math.floor(Math.random() * 8 * 365 * 86_400_000)) } });
    }

    // Exact recount before anything is written.
    const preview = await (await bulk(request, mine.id, { mode: "preview" })).json();
    expect(preview.matching).toBe(3);
    expect(preview.publishable).toBe(3);
    expect(preview.scopes).toMatchObject({ country: 1, region: 1, city: 1 });

    const result = await (await bulk(request, mine.id, { mode: "publish", expectedCount: preview.matching })).json();
    expect(result).toMatchObject({ published: 3, skipped: 0, failed: 0 });

    const events = (await (await request.get("/api/events")).json()) as { id: string; title: string; lat: number | null; lng: number | null; locationPrecision: string | null; locationScope: string | null; adminRegion: string | null; city: string | null; sources: { url: string | null }[] }[];
    const byTitle = (t: string) => events.find((e) => e.title.startsWith(t))!;
    const libya = byTitle("Libya central bank");
    expect(libya).toMatchObject({ lat: null, lng: null, locationScope: "country", locationPrecision: "country" });
    const darfur = byTitle("Aid convoy delayed entering North Darfur");
    expect(darfur).toMatchObject({ locationScope: "region", locationPrecision: "region", adminRegion: "North Darfur State" });
    expect(darfur.lat).toBeCloseTo(16.0, 0);
    expect(darfur.locationPrecision).not.toBe("exact");
    const fasher = byTitle("Shelling reported near El Fasher");
    expect(fasher).toMatchObject({ locationScope: "city", locationPrecision: "city", city: "El Fasher" });
    // The source's own link and headline are preserved, and nothing outside the filter was touched.
    expect(libya.sources[0]?.url).toBe(country.url);
    expect(darfur.sources[0]?.url).toBe(region.url);
    expect(fasher.sources[0]?.url).toBe(city.url);
    expect(events.some((e) => e.sources.some((s) => s.url === outsider.url))).toBe(false);
    const stillPending = await (await bulk(request, other.id, { mode: "preview" })).json();
    expect(stillPending.matching).toBe(1);
  });

  test("reports that cannot stand on their own are skipped with a reason, not published and not failed", async ({ request }) => {
    const src = await makeSource(request, "skip");
    await addReport(request, src.id, `Markets close higher on Friday ${uid()}`, "Investors welcomed the data.");
    const ok = await addReport(request, src.id, `Libya passes a new banking law ${uid()}`, "Parliament voted on Tuesday.");
    const result = await (await bulk(request, src.id, { mode: "publish" })).json();
    expect(result).toMatchObject({ published: 1, skipped: 1, failed: 0 });
    expect(result.outcomes.find((o: { status: string }) => o.status === "skipped").reason).toMatch(/location|conflict/i);
    const events = (await (await request.get("/api/events")).json()) as { sources: { url: string | null }[] }[];
    expect(events.some((e) => e.sources.some((s) => s.url === ok.url))).toBe(true);
  });

  test("a changed filtered set is refused rather than published blindly", async ({ request }) => {
    const src = await makeSource(request, "stale");
    await addReport(request, src.id, `Libya names a new envoy ${uid()}`, "The ministry confirmed on Monday.");
    const res = await bulk(request, src.id, { mode: "publish", expectedCount: 5 });
    expect(res.status()).toBe(409);
    expect((await res.json()).error).toMatch(/changed/);
  });

  test("publish selected only publishes the chosen reports", async ({ request }) => {
    const src = await makeSource(request, "selected");
    const a = await addReport(request, src.id, `Libya approves a new budget ${uid()}`, "Lawmakers voted on Sunday.");
    await addReport(request, src.id, `Libya opens a new port ${uid()}`, "Officials cut the ribbon on Monday.");
    const result = await (await bulk(request, src.id, { mode: "publish", ids: [a.id] })).json();
    expect(result).toMatchObject({ published: 1, failed: 0 });
    expect((await (await bulk(request, src.id, { mode: "preview" })).json()).matching).toBe(1);
  });
});

test.describe("bulk publish resilience", () => {
  test("one failing report does not stop the others, and the failure reason is reported", async ({ request }) => {
    const src = await makeSource(request, "fail");
    const reports = [];
    for (const t of ["Libya signs a trade deal", "Libya names a new envoy", "Libya reopens an airport"]) reports.push(await addReport(request, src.id, `${t} ${uid()}`, "Officials confirmed the news on Monday."));
    const poisoned = reports[1]!.id;
    let attempted = 0;
    const { publishRawItem } = await import("@/lib/ingestion/publish-item");
    const result = await runBulkPublish(filtersFromParams(new URLSearchParams(`status=pending&sourceId=${src.id}`)), {
      publish: async (id, input) => {
        attempted++;
        if (id === poisoned) throw new Error("simulated write failure");
        return publishRawItem(id, input);
      },
    });
    expect(attempted).toBe(3);
    expect(result).toMatchObject({ published: 2, failed: 1, skipped: 0 });
    expect(result.outcomes.find((o) => o.status === "failed")).toMatchObject({ id: poisoned, reason: "simulated write failure" });
    expect(await prisma.rawIngestionItem.count({ where: { sourceId: src.id, processingStatus: "published" } })).toBe(2);
  });
});

async function openIncoming(page: Page, sourceId: string) {
  await page.goto("/admin/incoming");
  await page.getByTestId("incoming-filters").getByLabel("Source").selectOption(sourceId);
}

test.describe("Incoming Reports page", () => {
  test.beforeEach(({ isMobile }) => {
    test.skip(isMobile, "admin tables are desktop-only");
  });

  test("each report has Review and Publish side by side; Publish publishes it through the existing flow", async ({ page, request }) => {
    const src = await makeSource(request, "single");
    const r = await addReport(request, src.id, `Libya elects a new speaker ${uid()}`, "The vote took place on Sunday.");
    await openIncoming(page, src.id);
    const card = page.getByTestId(`incoming-item-${r.id}`);
    await expect(card.getByRole("button", { name: "Review" })).toBeVisible();
    const publish = card.getByTestId(`quick-publish-${r.id}`);
    await expect(publish).toBeVisible();
    // Publish sits with Review in the same action cluster.
    const actions = card.getByTestId(`row-actions-${r.id}`);
    await expect(actions.getByRole("button", { name: "Review" })).toBeVisible();
    await expect(actions.getByTestId(`quick-publish-${r.id}`)).toBeVisible();
    await publish.click();
    await expect(page.getByTestId(`incoming-item-${r.id}`)).toHaveCount(0);
    const events = (await (await request.get("/api/events")).json()) as { title: string; lat: number | null; sources: { url: string | null }[] }[];
    const ev = events.find((e) => e.title.startsWith("Libya elects a new speaker"))!;
    expect(ev.lat).toBeNull();
    expect(ev.sources[0]?.url).toBe(r.url);
  });

  test("a report that cannot be published shows the error next to it instead of failing silently", async ({ page, request }) => {
    const src = await makeSource(request, "error");
    const r = await addReport(request, src.id, `Libya announces new fuel prices ${uid()}`, "Prices change on Monday.");
    await page.route("**/api/admin/incoming/*/publish", (route) => route.fulfill({ status: 400, json: { error: "Simulated validation error" } }));
    await openIncoming(page, src.id);
    await page.getByTestId(`quick-publish-${r.id}`).click();
    await expect(page.getByTestId(`publish-error-${r.id}`)).toHaveText("Simulated validation error");
    await expect(page.getByTestId(`incoming-item-${r.id}`)).toBeVisible();
  });

  test("the review form asks for coordinates only for an exact point", async ({ page, request }) => {
    const src = await makeSource(request, "form");
    const r = await addReport(request, src.id, `Libya holds a national census ${uid()}`, "Enumerators start on Monday.");
    await openIncoming(page, src.id);
    const card = page.getByTestId(`incoming-item-${r.id}`);
    await card.getByRole("button", { name: "Review" }).click();
    const scope = card.getByTestId("scope-select");
    await expect(scope).toHaveValue("country"); // auto-populated from the headline
    await expect(card.getByLabel("Latitude")).toHaveCount(0);
    await expect(card.getByTestId("scope-hint")).toContainText("no marker");
    await scope.selectOption("region");
    await expect(card.getByLabel(/^Region \(oblast/)).toBeVisible();
    await card.getByRole("button", { name: "Publish" }).click();
    await expect(card.getByTestId(`review-publish-error-${r.id}`)).toContainText(/region/i);
    await scope.selectOption("point");
    await expect(card.getByLabel("Latitude")).toBeVisible();
    await card.getByRole("button", { name: "Publish" }).click();
    await expect(card.getByTestId(`review-publish-error-${r.id}`)).toContainText(/latitude and longitude/i);
    await scope.selectOption("country");
    await card.getByRole("button", { name: "Publish" }).click();
    await expect(page.getByTestId(`incoming-item-${r.id}`)).toHaveCount(0);
  });

  test("Publish filtered: the count follows the filters, a confirmation shows the summary, and the result reports published / skipped / failed", async ({ page, request }) => {
    const src = await makeSource(request, "filtered");
    const other = await makeSource(request, "unfiltered");
    const a = await addReport(request, src.id, `Libya agrees a new oil deal ${uid()}`, "The agreement was signed on Sunday.");
    // Deliberately distinct wording/region from other fixtures in this file using "Zhytomyr Oblast air
    // raid alert" text (e.g. the "publishes exactly the filtered reports" test above) — same-batch
    // corroboration (lib/ingestion/bulk-publish.ts) now freshly re-checks every candidate against real
    // published events at publish time, so near-identical fixture wording across tests in this
    // long-lived shared test DB can otherwise collide and get flagged as a likely duplicate.
    const b = await addReport(request, src.id, `Curfew extended in Chernihiv Oblast ${uid()}`, "Regional officials extended the overnight curfew by two hours.");
    await addReport(request, src.id, `Markets close higher on Friday ${uid()}`, "Investors welcomed the data.");
    const outsider = await addReport(request, other.id, `Libya cabinet reshuffle ${uid()}`, "A new minister was named.");

    await openIncoming(page, src.id);
    await expect(page.getByTestId("incoming-count-number")).toHaveText("3");
    const button = page.getByTestId("publish-filtered");
    await expect(button).toContainText("(3)");
    await button.click();

    const dialog = page.getByTestId("bulk-dialog");
    await expect(dialog).toBeVisible(); // confirmation, nothing published yet
    await expect(page.getByTestId("bulk-matching")).toHaveText("3");
    await expect(page.getByTestId("bulk-publishable")).toHaveText("2");
    await expect(page.getByTestId("bulk-skipped-count")).toHaveText("1");
    await expect(page.getByTestId("bulk-scopes")).toContainText("Country 1");
    await expect(page.getByTestId("bulk-scopes")).toContainText("Region 1");
    expect(await prisma.rawIngestionItem.count({ where: { sourceId: src.id, processingStatus: "published" } })).toBe(0);

    await page.getByTestId("bulk-confirm").click();
    await expect(page.getByTestId("bulk-result")).toBeVisible();
    await expect(page.getByTestId("bulk-published")).toHaveText("2");
    await expect(page.getByTestId("bulk-result-skipped")).toHaveText("1");
    await expect(page.getByTestId("bulk-failed")).toHaveText("0");
    await expect(page.getByTestId("bulk-skipped-list")).toContainText("No usable location");
    await page.getByRole("button", { name: "Close", exact: true }).last().click();

    // Published ones left the queue; the skipped one and the other source's report stayed.
    await expect(page.getByTestId(`incoming-item-${a.id}`)).toHaveCount(0);
    await expect(page.getByTestId(`incoming-item-${b.id}`)).toHaveCount(0);
    await expect(page.getByTestId("incoming-count-number")).toHaveText("1");
    expect((await prisma.rawIngestionItem.findUnique({ where: { id: outsider.id } }))?.processingStatus).toBe("pending");
  });

  test("Publish selected uses the checkboxes and select-all-visible", async ({ page, request }) => {
    const src = await makeSource(request, "checkboxes");
    const a = await addReport(request, src.id, `Libya reopens a border crossing ${uid()}`, "Traffic resumed on Monday.");
    const b = await addReport(request, src.id, `Libya expands a coastal port ${uid()}`, "Work begins next month.");
    await openIncoming(page, src.id);
    await expect(page.getByTestId("publish-selected")).toBeDisabled();
    await page.getByTestId(`select-${a.id}`).check();
    await expect(page.getByTestId("publish-selected")).toContainText("(1)");
    await page.getByTestId("select-all-visible").check();
    await expect(page.getByTestId("publish-selected")).toContainText("(2)");
    await page.getByTestId("select-all-visible").uncheck();
    await page.getByTestId(`select-${b.id}`).check();
    await page.getByTestId("publish-selected").click();
    await expect(page.getByTestId("bulk-publishable")).toHaveText("1");
    await page.getByTestId("bulk-confirm").click();
    await expect(page.getByTestId("bulk-published")).toHaveText("1");
    expect((await prisma.rawIngestionItem.findUnique({ where: { id: a.id } }))?.processingStatus).toBe("pending");
    expect((await prisma.rawIngestionItem.findUnique({ where: { id: b.id } }))?.processingStatus).toBe("published");
  });
});
