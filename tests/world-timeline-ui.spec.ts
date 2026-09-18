import { test, expect } from "@playwright/test";

// Real-browser coverage for the /world Global Timeline control (spec
// "Global Timeline / Historical Playback"), complementing
// tests/world-timeline.spec.ts (pure preset resolution) and
// tests/world-timeline-api.spec.ts (reconstruction correctness) with an
// actual render pass — confirms the control reaches the real UI, is
// visibly distinct from the pre-existing recency filter, and switching
// modes updates the map/feed and returns cleanly to Live.

function unique() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

test("1. Selecting a historical preset shows the 'Viewing ...' indicator and historical feed heading; Return to Live restores the live one, with no console errors", async ({ page, isMobile }) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });

  await page.goto("/world");
  if (isMobile) {
    // Desktop-only feed column ("Live/Historical Event Feed" heading);
    // mobile uses the bottom sheet instead — same convention as
    // tests/map.spec.ts's "selecting an event from the feed" test.
    test.skip();
  }
  await expect(page.getByText("Live Event Feed")).toBeVisible();
  await expect(page.getByTestId("historical-indicator")).not.toBeVisible();

  const timeline = page.getByTestId("timeline-controls");
  await timeline.getByRole("radio", { name: "24H" }).click();

  await expect(page.getByTestId("historical-indicator")).toBeVisible();
  await expect(page.getByText("Historical Event Feed")).toBeVisible();
  await expect(page.getByText(/^Viewing /)).toBeVisible();

  await page.getByTestId("return-to-live-button").click();
  await expect(page.getByText("Live Event Feed")).toBeVisible();
  await expect(page.getByTestId("historical-indicator")).not.toBeVisible();

  expect(errors).toEqual([]);
});

test("2. The timeline control and the pre-existing recency filter are two distinct, independently operable controls", async ({ page, isMobile }) => {
  await page.goto("/world");
  if (isMobile) {
    test.skip();
  }

  const timelineGroup = page.getByRole("radiogroup", { name: "Playback" });
  const recencyGroup = page.getByRole("radiogroup", { name: "Time", exact: true });
  await expect(timelineGroup).toBeVisible();
  await expect(recencyGroup).toBeVisible();

  // Changing the recency filter must not put the map into historical mode.
  await recencyGroup.getByRole("radio", { name: "6H" }).click();
  await expect(page.getByTestId("historical-indicator")).not.toBeVisible();
  await expect(page.getByText("Live Event Feed")).toBeVisible();
});

test("3. A custom timestamp can be selected via the date/time picker and produces a historical view", async ({ request, page, isMobile }) => {
  test.skip(isMobile, "Asserts the event title in the desktop-only feed column; mobile uses the bottom sheet instead.");
  // A fresh event so this test doesn't depend on whatever the shared DB
  // already contains at an arbitrary past moment.
  const created = await request.post("/api/admin/events", {
    data: {
      title: `Timeline UI custom test ${unique()}`,
      summary: "Independently written summary.",
      eventType: "airstrike",
      latitude: 50.45,
      longitude: 30.52,
      countryCode: "UA",
      region: "Europe",
      occurredAt: "2026-09-17T10:00:00.000Z",
      severity: "elevated",
      sourceName: `Timeline UI custom source ${unique()}`,
    },
  });
  const event = await created.json();
  await request.post(`/api/admin/events/${event.id}/publish`);

  await page.goto("/world");
  const timeline = page.getByTestId("timeline-controls");
  await timeline.getByTestId("timeline-custom-toggle").click();

  // Computed INSIDE the page (not in the test-runner's own Node process)
  // so the timezone used to build this "local wall clock" string is
  // guaranteed to be the same one the browser's datetime-local input
  // parses it back with — the test runner and the launched browser are
  // separate processes that don't necessarily share a timezone. A full
  // hour ahead (the input has no `max` clamp — see TimelineControls —
  // so a future value is fine) comfortably clears
  // resolveTimelineTimestamp's own round-down-to-the-minute behavior,
  // which a same-minute "now" could otherwise land on the wrong side of
  // relative to the event's createdAt.
  const nowLocalValue = await page.evaluate(() => {
    const d = new Date(Date.now() + 60 * 60_000);
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
  });
  await page.getByTestId("timeline-custom-input").fill(nowLocalValue);
  await page.getByTestId("timeline-custom-apply").click();

  await expect(page.getByTestId("historical-indicator")).toBeVisible();
  await expect(page.getByText(event.title, { exact: false })).toBeVisible({ timeout: 10_000 });

  await request.delete(`/api/admin/events/${event.id}`);
});
