import { test, expect } from "@playwright/test";

// Deterministic coverage for the homepage globe's conflict-preview
// overlay UI fix: opening a conflict card visually covers the bottom
// "Events / Conflicts / Energy / Trade" layer controls (TimeLayerControls
// in app/page.tsx) without hiding them, leaving both visible/interactive
// at once. Desktop-only — the mobile ConflictPreviewPanel already renders
// its own full-screen backdrop (components/ui/bottom-sheet.tsx), which
// already visually covers everything behind it.
//
// Triggers conflict selection via the "Most Relevant To You" card's
// quick-select buttons (components/home/relevant-to-you-card.tsx) rather
// than clicking the 3D globe canvas directly — same onSelectConflict
// callback and selectedSlug state the globe itself uses, but a reliable
// DOM element instead of a WebGL canvas pixel coordinate.
test.describe("Homepage globe conflict overlay", () => {
  test("opening a conflict hides the layer controls; closing it restores them", async ({ page, isMobile }) => {
    test.skip(isMobile, "Mobile's conflict preview is a full-screen bottom sheet with its own backdrop.");

    await page.goto("/");
    const controls = page.getByTestId("globe-layer-controls");
    await expect(controls).toBeVisible();
    await expect(controls).toHaveAttribute("aria-hidden", "false");

    const card = page.getByTestId("relevant-to-you-card");
    await card.locator("button[data-testid^='conflict-quick-select-']").first().click();

    // The conflict card is open; the layer controls must no longer be
    // visibly presented (even though the element can remain mounted).
    await expect(controls).toHaveAttribute("aria-hidden", "true");
    await expect(controls).toHaveCSS("opacity", "0");

    await page.getByRole("button", { name: "Close preview" }).click();
    await expect(controls).toHaveAttribute("aria-hidden", "false");
    await expect(controls).toHaveCSS("opacity", "1");
  });

  test("opening a second conflict without closing the first keeps the controls hidden throughout", async ({
    page,
    isMobile,
  }) => {
    test.skip(isMobile, "Mobile's conflict preview is a full-screen bottom sheet with its own backdrop.");

    await page.goto("/");
    const controls = page.getByTestId("globe-layer-controls");
    const card = page.getByTestId("relevant-to-you-card");
    const buttons = card.locator("button[data-testid^='conflict-quick-select-']");

    await buttons.nth(0).click();
    await expect(controls).toHaveAttribute("aria-hidden", "true");

    const count = await buttons.count();
    if (count > 1) {
      await buttons.nth(1).click();
      await expect(controls).toHaveAttribute("aria-hidden", "true");
    }
  });
});
