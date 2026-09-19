import { test, expect } from "@playwright/test";

test.use({ timezoneId: "Europe/Helsinki" });

// Deterministic coverage for admin event lifecycle management: manual
// creation (Draft by default), Publish/Unpublish/Delete, editing, and the
// guarantee that supporting-source attribution survives all of the
// above. One continuous narrative mirroring the spec's own manual
// verification steps (A-L), driven through the real admin UI rather than
// direct API calls, so the actual buttons/forms are what's under test.
test.describe.serial("Event lifecycle management (admin)", () => {
  const title = `Lifecycle Test Event ${Date.now()}`;
  const sourceUrl = "https://fixture.test/lifecycle/original-report";
  const sourceName = `Lifecycle Test Source ${Date.now()}`;
  let eventId: string;

  // isMobile: false, scoped to just this one test — see
  // tests/admin.spec.ts's own comment on the identical override for the
  // full rationale: Chromium's `isMobile: true` viewport emulation
  // (Pixel 7's address-bar show/hide-on-scroll simulation) can desync the
  // visual viewport from the layout viewport after a scrollIntoView-driven
  // scroll, which this form's "grid gap-3 sm:grid-cols-2" field layout
  // triggers on Mobile — confirmed unrelated to this form's own markup
  // (reproduces identically on other pages' scrolled-into-view clicks)
  // and to not affect a real tap. Scoped narrowly (not file-wide, unlike
  // admin.spec.ts) because tests 3/5 below read the `isMobile` fixture
  // themselves to skip a desktop-only assertion — overriding it file-wide
  // would make that check silently skip nothing on the Mobile project.
  test.describe("create-form click workaround", () => {
    test.use({ isMobile: false });

    test("1. Create manual event as Draft via the admin 'Create Event' form", async ({ page }) => {
      await page.goto("/admin/events/new");
      await page.getByLabel("Title").fill(title);
      await page.getByLabel("Summary / description").fill("A manually authored test event for lifecycle coverage.");
      await page.getByLabel("Latitude").fill("48.85");
      await page.getByLabel("Longitude").fill("2.35");
      await page.getByLabel("Country code").fill("FR");
      await page.getByLabel("Source name").fill(sourceName);
      await page.getByLabel("Source URL (optional)").fill(sourceUrl);

      await page.getByRole("button", { name: "Save as Draft" }).click();
      // Cuids are ~25 chars — long enough that this pattern can't also
      // match /admin/events/new itself (a real bug caught here: a looser
      // `[a-z0-9]+$` matches "new" too, so the assertion below would pass
      // immediately on the form's OWN url, before the redirect even fires,
      // and capture "new" as eventId instead of waiting for it).
      await page.waitForURL(/\/admin\/events\/[a-z0-9]{20,}$/);
      eventId = page.url().split("/").pop()!;

      await expect(page.getByTestId("event-status-badge")).toHaveAttribute("data-status", "draft");
      await expect(page.getByText(title)).toBeVisible();
    });
  });

  test("2. Draft event does not appear on /world (public feed or API)", async ({ page, request }) => {
    const events = await request.get("/api/events").then((r) => r.json());
    expect(events.some((e: { id: string }) => e.id === eventId)).toBe(false);

    await page.goto("/world");
    await expect(page.getByText(title)).not.toBeVisible();
  });

  test("3. Publish makes the event visible on /world", async ({ page, request, isMobile }) => {
    await page.goto(`/admin/events/${eventId}`);
    await page.getByTestId("publish-event-button").click();
    await expect(page.getByTestId("event-status-badge")).toHaveAttribute("data-status", "published");

    const events = await request.get("/api/events").then((r) => r.json());
    expect(events.some((e: { id: string }) => e.id === eventId)).toBe(true);

    // The API check above is the cross-platform-reliable one (it's
    // exactly what /world polls — hooks/use-live-events.ts). The feed's
    // own DOM is desktop-only; mobile renders it inside a closed bottom
    // sheet by default (see tests/map.spec.ts's same convention), so it
    // exists but isn't visible there.
    if (!isMobile) {
      await page.goto("/world");
      await expect(page.getByText(title)).toBeVisible();
    }
  });

  test("4. Unpublish removes the event from /world without deleting it or its source history", async ({ page, request }) => {
    await page.goto(`/admin/events/${eventId}`);
    await page.getByTestId("unpublish-event-button").click();
    // "Unpublished" (was live) is distinct from "Draft" (never published) —
    // both share published: false, but publishedAt was already set on
    // first publish and must not be cleared by this action.
    await expect(page.getByTestId("event-status-badge")).toHaveAttribute("data-status", "unpublished");

    const events = await request.get("/api/events").then((r) => r.json());
    expect(events.some((e: { id: string }) => e.id === eventId)).toBe(false);

    await page.goto("/world");
    await expect(page.getByText(title)).not.toBeVisible();

    // Still fully present in the admin view, with its source intact.
    const detail = await request.get(`/api/admin/events/${eventId}`).then((r) => r.json());
    expect(detail.sources).toHaveLength(1);
    expect(detail.sources[0].url).toBe(sourceUrl);
  });

  test("5. Republishing makes the event reappear", async ({ page, request, isMobile }) => {
    await page.goto(`/admin/events/${eventId}`);
    await page.getByTestId("publish-event-button").click();
    await expect(page.getByTestId("event-status-badge")).toHaveAttribute("data-status", "published");

    const events = await request.get("/api/events").then((r) => r.json());
    expect(events.some((e: { id: string }) => e.id === eventId)).toBe(true);

    if (!isMobile) {
      await page.goto("/world");
      await expect(page.getByText(title)).toBeVisible();
    }
  });

  test("6. Editing the event preserves its supporting-source relationship and manual source URL", async ({
    page,
    request,
  }) => {
    expect((await request.patch(`/api/admin/events/${eventId}`, { data: {
      verificationStatus: "disputed", locationName: "Paris", occurredAt: "2026-09-17T10:12:34.567Z",
    } })).ok()).toBe(true);
    const before = await request.get(`/api/admin/events/${eventId}`).then((r) => r.json());
    expect(before.sources).toHaveLength(1);

    await page.goto(`/admin/events/${eventId}`);
    await page.getByTestId("edit-event-button").click();
    await expect(page.getByTestId("edit-event-form")).toBeVisible();

    const editedTitle = `${title} (edited)`;
    const titleInput = page.getByTestId("edit-event-form").getByLabel("Title");
    await titleInput.fill(editedTitle);
    await page.getByTestId("save-event-button").click();

    await expect(page.getByText(editedTitle)).toBeVisible();

    const after = await request.get(`/api/admin/events/${eventId}`).then((r) => r.json());
    expect(after.title).toBe(editedTitle);
    // Editing ordinary fields must never touch EventSource links.
    expect(after.sources).toHaveLength(1);
    expect(after.sources[0].url).toBe(sourceUrl);
    expect(after.sourceCount).toBe(before.sourceCount);
    expect(after.occurredAt).toBe(before.occurredAt);
    expect(after.disputed).toBe(true);
    expect(after.locationName).toBe("Paris");
  });

  test("7. Delete removes the event from admin and public views; its supporting report returns to pending rather than being deleted", async ({
    page,
    request,
  }) => {
    // Find the raw ingestion item this event was published from, so we
    // can confirm afterward that deleting the EVENT didn't delete the
    // underlying REPORT too.
    const beforeDetail = await request.get(`/api/admin/events/${eventId}`).then((r) => r.json());
    const sourceUrlBefore = beforeDetail.sources[0].url;

    await page.goto(`/admin/events/${eventId}`);
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByTestId("delete-event-button").click();
    await expect(page).toHaveURL(/\/admin\/events$/);

    const listRes = await request.get("/api/admin/events");
    const list = await listRes.json();
    expect(list.some((e: { id: string }) => e.id === eventId)).toBe(false);

    const events = await request.get("/api/events").then((r) => r.json());
    expect(events.some((e: { id: string }) => e.id === eventId)).toBe(false);

    const detailRes = await request.get(`/api/admin/events/${eventId}`);
    expect(detailRes.status()).toBe(404);

    // The raw ingestion item is NOT deleted — it's returned to "pending"
    // for re-review (lib/db/repositories/events.ts's deleteEventCleanly).
    const pending = await request.get("/api/admin/incoming?status=pending").then((r) => r.json());
    const revived = pending.find((i: { originalUrl: string }) => i.originalUrl === sourceUrlBefore);
    expect(revived).toBeTruthy();
    expect(revived.processingStatus).toBe("pending");
  });
});
