import { test, expect } from "@playwright/test";

// Runs under both the Desktop and Mobile Playwright projects (see
// playwright.config.ts) — asserts each primary route renders without
// crashing and its expected primary navigation surface is present.
test.describe("Responsive navigation smoke test", () => {
  test("homepage renders the globe and nav", async ({ page, isMobile }) => {
    await page.goto("/");
    // Desktop and mobile variants of the Global Status card both exist in
    // the DOM at once (Tailwind responsive classes toggle visibility)
    // rather than being conditionally rendered, so filter to whichever
    // copy is actually visible at this viewport.
    // The Overview landing's own "Global status" summary sits below the fold, so take the first visible copy.
    await expect(page.getByText("Global Status").filter({ visible: true }).first()).toBeVisible();
    if (isMobile) {
      await expect(page.getByRole("link", { name: "Map", exact: true })).toBeVisible();
    } else {
      await expect(page.getByRole("link", { name: "Overview" })).toBeVisible();
    }
  });

  test("/world renders the map", async ({ page }) => {
    await page.goto("/world");
    await expect(page.getByRole("application", { name: "Operational conflict map" })).toBeVisible();
  });

  test("/conflicts renders a list", async ({ page }) => {
    await page.goto("/conflicts");
    await expect(page.locator("body")).not.toHaveText("");
  });

  test("/for-you renders", async ({ page }) => {
    await page.goto("/for-you");
    await expect(page.locator("body")).not.toHaveText("");
  });

  test("/markets renders", async ({ page }) => {
    await page.goto("/markets");
    await expect(page.locator("body")).not.toHaveText("");
  });

  test("/profile renders the logged-out header", async ({ page }) => {
    await page.goto("/profile");
    await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
  });
});
