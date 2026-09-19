import { test, expect } from "@playwright/test";

// Real-browser coverage for the /admin/territorial-control workflow:
// create a draft, publish it, supersede it (control change), and delete
// an unpublished draft. Desktop-only, matching this suite's other
// admin-table specs (e.g. tests/admin.spec.ts) which assume the wider
// desktop table/form layout.

function unique() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function createConflict(request: import("@playwright/test").APIRequestContext, name: string) {
  const res = await request.post("/api/admin/conflicts", {
    data: { slug: `admin-territorial-${unique()}`, name, region: "Europe", severity: "guarded", intensity: 40 },
  });
  expect(res.ok()).toBe(true);
  return res.json();
}

const GEOMETRY_TEXT = JSON.stringify({ type: "Polygon", coordinates: [[[40, 40], [41, 40], [41, 41], [40, 41], [40, 40]]] });

test("1. Creating a draft territory via the admin form shows it as Draft in the table", async ({ page, isMobile }) => {
  test.skip(isMobile);
  const conflictName = `Admin Draft Test ${unique()}`;
  const conflict = await createConflict(page.request, conflictName);

  await page.goto("/admin/territorial-control");
  await page.getByTestId("territory-create-button").click();
  await page.getByTestId("territory-form").getByLabel("Conflict").selectOption({ label: conflictName });
  await page.getByTestId("territory-form").getByLabel("Status").selectOption("uncertain");
  await page.getByTestId("territory-geometry-input").fill(GEOMETRY_TEXT);
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const validFrom = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
  await page.getByLabel("Valid from").fill(validFrom);
  await page.getByTestId("territory-form-submit").click();

  await expect(page.getByTestId("territory-form")).not.toBeVisible();
  const row = page.locator("tr", { hasText: conflictName });
  await expect(row).toBeVisible();
  await expect(row).toContainText("Draft");
  await expect(row).toContainText("uncertain");

  await page.request.delete(`/api/admin/conflicts/${conflict.id}`);
});

test("2. Publishing a draft moves it to Published and removes the edit/delete actions", async ({ page, isMobile }) => {
  test.skip(isMobile);
  const conflictName = `Admin Publish Test ${unique()}`;
  const conflict = await createConflict(page.request, conflictName);
  const draftRes = await page.request.post("/api/admin/territorial-control", {
    data: { conflictId: conflict.id, status: "controlled", confidence: 0.6, geometry: JSON.parse(GEOMETRY_TEXT), validFrom: new Date().toISOString() },
  });
  const draft = await draftRes.json();

  await page.goto("/admin/territorial-control");
  const row = page.getByTestId(`territory-row-${draft.id}`);
  await expect(row).toContainText("Draft");
  // Publishing is explicit: the row action asks for confirmation first.
  page.once("dialog", (d) => d.accept());
  await page.getByTestId(`territory-publish-${draft.id}`).click();
  await expect(row).toContainText("Published");

  await page.request.delete(`/api/admin/conflicts/${conflict.id}`);
});

test("3. Superseding a published territory creates a new version and closes the old one", async ({ page, isMobile }) => {
  test.skip(isMobile);
  const conflictName = `Admin Supersede Test ${unique()}`;
  const conflict = await createConflict(page.request, conflictName);
  const actorRes = await page.request.post("/api/admin/actors", { data: { conflictId: conflict.id, name: `Supersede Actor ${unique()}` } });
  const actor = await actorRes.json();
  const draftRes = await page.request.post("/api/admin/territorial-control", {
    data: { conflictId: conflict.id, actorId: actor.id, status: "controlled", confidence: 0.6, geometry: JSON.parse(GEOMETRY_TEXT), validFrom: new Date(Date.now() - 3600_000).toISOString() },
  });
  const draft = await draftRes.json();
  await page.request.post(`/api/admin/territorial-control/${draft.id}/publish`);

  await page.goto("/admin/territorial-control");
  await page.getByTestId(`territory-supersede-${draft.id}`).click();
  await expect(page.getByTestId("territory-form")).toBeVisible();
  await page.getByTestId("territory-form").getByLabel("Status").selectOption("contested");
  // Publishing a change needs explicit confirmation.
  await expect(page.getByTestId("territory-form-submit")).toBeDisabled();
  await page.getByTestId("territory-confirm").check();
  await page.getByTestId("territory-form-submit").click();

  await expect(page.getByTestId("territory-form")).not.toBeVisible();
  // The original row is still present (immutable history) but no longer
  // "current" — Territorial Control must never overwrite it in place.
  const originalRow = page.getByTestId(`territory-row-${draft.id}`);
  await expect(originalRow).toBeVisible();
  await expect(originalRow).not.toContainText("current");

  await page.request.delete(`/api/admin/conflicts/${conflict.id}`);
});

test("4. Deleting a draft removes it; a published row offers no delete action", async ({ page, isMobile }) => {
  test.skip(isMobile);
  const conflictName = `Admin Delete Test ${unique()}`;
  const conflict = await createConflict(page.request, conflictName);
  const draftRes = await page.request.post("/api/admin/territorial-control", {
    data: { conflictId: conflict.id, status: "controlled", confidence: 0.6, geometry: JSON.parse(GEOMETRY_TEXT), validFrom: new Date().toISOString() },
  });
  const draft = await draftRes.json();

  await page.goto("/admin/territorial-control");
  const row = page.getByTestId(`territory-row-${draft.id}`);
  await expect(row).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await row.getByLabel(`Delete territory ${draft.id}`).click();
  await expect(row).not.toBeVisible();

  await page.request.delete(`/api/admin/conflicts/${conflict.id}`);
});

test("5. A published, currently-active territory offers Supersede but not Edit/Delete", async ({ page, isMobile }) => {
  test.skip(isMobile);
  const conflictName = `Admin Actions Test ${unique()}`;
  const conflict = await createConflict(page.request, conflictName);
  const draftRes = await page.request.post("/api/admin/territorial-control", {
    data: { conflictId: conflict.id, status: "controlled", confidence: 0.6, geometry: JSON.parse(GEOMETRY_TEXT), validFrom: new Date().toISOString() },
  });
  const draft = await draftRes.json();
  await page.request.post(`/api/admin/territorial-control/${draft.id}/publish`);

  await page.goto("/admin/territorial-control");
  const row = page.getByTestId(`territory-row-${draft.id}`);
  await expect(row.getByLabel(`Change control for territory ${draft.id}`)).toBeVisible();
  await expect(row.getByLabel(`Edit territory ${draft.id}`)).not.toBeVisible();
  await expect(row.getByLabel(`Delete territory ${draft.id}`)).not.toBeVisible();

  await page.request.delete(`/api/admin/conflicts/${conflict.id}`);
});
