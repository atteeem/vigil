import { test, expect } from "@playwright/test";

test.describe("Map/feed filters (/world)", () => {
  test("time range filter changes the event count", async ({ page }) => {
    await page.goto("/world");
    const timeGroup = page.getByRole("radiogroup", { name: "Time" });
    await timeGroup.getByRole("radio", { name: "1H" }).click();
    await page.waitForTimeout(200);
    const count1h = await page.getByText(/events in range/).textContent();

    await timeGroup.getByRole("radio", { name: "7D" }).click();
    await page.waitForTimeout(200);
    const count7d = await page.getByText(/events in range/).textContent();

    expect(count7d).not.toBe(count1h);
  });

  test("event type filter narrows the feed", async ({ page }) => {
    await page.goto("/world");
    await page.getByRole("radiogroup", { name: "Time" }).getByRole("radio", { name: "7D" }).click();
    const allCount = await page.getByText(/events in range/).textContent();

    await page.getByRole("button", { name: "Airstrike", exact: true }).click();
    await page.waitForTimeout(200);
    const airstrikeCount = await page.getByText(/events in range/).textContent();

    expect(airstrikeCount).not.toBe(allCount);
  });

  test("heatmap toggle switches the map display mode", async ({ page }) => {
    await page.goto("/world");
    const heatmapBtn = page.getByRole("button", { name: "Heatmap" });
    const markersBtn = page.getByRole("button", { name: "Markers" });
    await expect(markersBtn).toHaveAttribute("aria-pressed", "true");
    await heatmapBtn.click();
    await expect(heatmapBtn).toHaveAttribute("aria-pressed", "true");
    await expect(markersBtn).toHaveAttribute("aria-pressed", "false");
  });
});
