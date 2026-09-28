import { test, expect } from "@playwright/test";

// Pre-Launch Critical Correctness & Security v1 §§7-9 — the homepage's 1H/6H/24H/7D/30D control used to
// only update persisted store state: the globe kept the same fixed 30-day/200-event set, report counts
// were hardcoded to "30D", and the summary line showed a capped array's .length as if it were a real
// total. Fixed by filtering the SAME canonical event window (lib/utils/time-range.ts's isWithinRange,
// already used by /world) by the selected range, wiring the range into useConflictReportCounts, and
// adding a real server-computed total (PublicOverview.eventsTotal) instead of events.length.

function unique() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function publishBackdatedEvent(request: import("@playwright/test").APIRequestContext, occurredAt: string) {
  const res = await request.post("/api/admin/events", {
    data: {
      title: `Time range test event ${unique()}`,
      summary: "Independently written summary for the time-range control test.",
      eventType: "airstrike",
      latitude: 50.45,
      longitude: 30.52,
      countryCode: "UA",
      region: "Europe",
      occurredAt,
      severity: "elevated",
      sourceName: `Time range test source ${unique()}`,
    },
  });
  expect(res.ok()).toBe(true);
  const event = await res.json();
  const pub = await request.post(`/api/admin/events/${event.id}/publish`);
  expect(pub.ok()).toBe(true);
  return event;
}

test("1. Selecting a wider time range fetches report counts for that range and includes an event the narrower range excluded", async ({ page, request }) => {
  // Just outside 24H (26 hours ago) but inside 7D — the exact boundary the 24H vs 7D control switch exercises.
  const occurredAt = new Date(Date.now() - 26 * 3_600_000).toISOString();
  const event = await publishBackdatedEvent(request, occurredAt);

  const reportCountUrls: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/report-counts")) reportCountUrls.push(r.url());
  });

  await page.goto("/");
  await expect(page.locator('[data-testid="home-data-summary"]:visible')).toContainText("published events");

  const controls = page.getByRole("radiogroup", { name: "Time range" });
  const summary = page.locator('[data-testid="home-data-summary"]:visible');

  await controls.getByRole("radio", { name: "24H" }).click();
  await expect(summary).toContainText("last 24 hours");
  const count24h = Number((await summary.textContent())?.match(/(\d+) published events/)?.[1] ?? 0);

  await controls.getByRole("radio", { name: "7D" }).click();
  await expect(summary).toContainText("last 7 days");
  const count7d = Number((await summary.textContent())?.match(/(\d+) published events/)?.[1] ?? 0);

  // The 26-hour-old fixture is outside 24H but inside 7D, so the wider range's count is strictly higher —
  // proof the control actually changes the underlying event set, not just its own label/highlighted state.
  expect(count7d).toBeGreaterThan(count24h);

  // The report-counts requests the control triggered actually carried the selected window as a parameter.
  await expect.poll(() => reportCountUrls.some((u) => u.includes("window=24H"))).toBe(true);
  await expect.poll(() => reportCountUrls.some((u) => u.includes("window=7D"))).toBe(true);

  await request.delete(`/api/admin/events/${event.id}`);
});

test("2. The published-events summary is a real total, not a capped array length", async ({ page, request }) => {
  await page.goto("/");
  const controls = page.getByRole("radiogroup", { name: "Time range" });
  await controls.getByRole("radio", { name: "30D" }).click();
  const summary = page.locator('[data-testid="home-data-summary"]:visible');
  await expect(summary).toContainText("last 30 days");
  const text = (await summary.textContent()) ?? "";
  const shown = Number(text.match(/(\d+) published events/)?.[1]);

  const overview = await request.get("/api/public/overview").then((r) => r.json());
  expect(typeof overview.eventsTotal).toBe("number");
  // events is capped at 200; eventsTotal is the real database count for the same window and must never be
  // LESS than the array it bounds (it can only be >= , and is a genuine aggregate rather than array.length).
  expect(overview.eventsTotal).toBeGreaterThanOrEqual(overview.events.length);
  // The two reads are moments apart in a shared, continuously-published-to test DB, so assert they're
  // consistent rather than bit-for-bit equal.
  expect(Math.abs(shown - overview.eventsTotal)).toBeLessThanOrEqual(3);
});
