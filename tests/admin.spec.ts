import { test, expect } from "@playwright/test";

test.describe("Admin Source Manager (/admin/sources)", () => {
  test("seeded Telegram sources are disabled and report the adapter-disabled error on test", async ({ page }) => {
    await page.goto("/admin/sources");
    const row = page.locator("tr", { hasText: "Liveuamap Source" });
    await expect(row).toBeVisible();
    await expect(row.getByRole("button", { name: "Off" })).toBeVisible();
    await expect(row).toContainText("unauthorized");

    await row.getByRole("button", { name: "Test" }).click();
    await expect(row).toContainText(/Telegram adapter disabled/);
  });

  test("add, disable, and delete a source", async ({ page }) => {
    const name = `E2E Source ${Date.now()}`;
    await page.goto("/admin/sources");
    await page.getByRole("button", { name: "Add Source" }).click();
    await page.getByLabel("Name").fill(name);
    await page.getByLabel("Type").selectOption("manual");
    await page.getByRole("button", { name: "Create Source" }).click();

    const row = page.locator("tr", { hasText: name });
    await expect(row).toBeVisible();
    await expect(row.getByRole("button", { name: "On" })).toBeVisible();

    await row.getByRole("button", { name: "On" }).click();
    await expect(row.getByRole("button", { name: "Off" })).toBeVisible();

    page.once("dialog", (dialog) => dialog.accept());
    await row.getByRole("button", { name: "Delete source" }).click();
    await expect(page.locator("tr", { hasText: name })).toHaveCount(0);
  });
});

test.describe("Admin Incoming Reports (/admin/incoming)", () => {
  test("manual submission → publish removes it from the pending queue and it reaches /api/events", async ({
    page,
    request,
  }) => {
    const title = `E2E Publish Test ${Date.now()}`;

    const sourceRes = await request.post("/api/admin/sources", {
      data: { name: `E2E Manual Source ${Date.now()}`, type: "manual" },
    });
    expect(sourceRes.ok()).toBeTruthy();
    const source = await sourceRes.json();

    const itemRes = await request.post("/api/admin/incoming/manual", {
      data: { sourceId: source.id, originalTitle: title, originalText: "E2E test summary." },
    });
    expect(itemRes.ok()).toBeTruthy();
    const item = await itemRes.json();

    await page.goto("/admin/incoming");
    const card = page.getByTestId(`incoming-item-${item.id}`);
    await expect(card).toBeVisible();
    await expect(card).toContainText(title);

    await card.getByRole("button", { name: "Review" }).click();
    await card.getByLabel("Latitude").fill("48.8566");
    await card.getByLabel("Longitude").fill("2.3522");
    await card.getByRole("button", { name: "Publish" }).click();

    await expect(page.getByTestId(`incoming-item-${item.id}`)).toHaveCount(0);

    const eventsRes = await request.get("/api/events");
    const events = await eventsRes.json();
    expect(events.some((e: { title: string }) => e.title === title)).toBe(true);
  });

  test("manual submission → reject removes it from the pending queue", async ({ page, request }) => {
    const title = `E2E Reject Test ${Date.now()}`;

    const sourceRes = await request.post("/api/admin/sources", {
      data: { name: `E2E Manual Source B ${Date.now()}`, type: "manual" },
    });
    const source = await sourceRes.json();
    const itemRes = await request.post("/api/admin/incoming/manual", {
      data: { sourceId: source.id, originalTitle: title, originalText: "E2E test summary." },
    });
    const item = await itemRes.json();

    await page.goto("/admin/incoming");
    const card = page.getByTestId(`incoming-item-${item.id}`);
    await expect(card).toBeVisible();
    await card.getByRole("button", { name: "Reject" }).click();
    await expect(page.getByTestId(`incoming-item-${item.id}`)).toHaveCount(0);
  });
});
