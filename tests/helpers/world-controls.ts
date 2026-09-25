import type { Page } from "@playwright/test";

// Phone /world keeps the map clear: the timeline collapses to a chip and the filter / layer controls open in bottom
// sheets. Specs that operate those controls call these helpers; on desktop (controls always visible) they do nothing.

const isPhoneLayout = (page: Page) => page.getByTestId("mobile-map-controls").isVisible();

export async function openWorldControls(page: Page, which: "filters" | "layers" | "timeline") {
  await page.getByRole("application", { name: "Operational conflict map" }).waitFor();
  if (!(await isPhoneLayout(page))) return;
  if (which === "timeline") {
    if (!(await page.getByTestId("mobile-timeline-panel").isVisible())) await page.getByTestId("mobile-timeline-toggle").click();
    return;
  }
  const sheet = page.getByRole("dialog", { name: which === "filters" ? "Map filters" : "Map layers" });
  if (await sheet.count()) return; // already open
  await closeWorldControls(page); // the other sheet
  await page.getByTestId(which === "filters" ? "mobile-filters-button" : "mobile-layers-button").click();
  await sheet.waitFor();
}

/** Closes an open phone control sheet so the map (legend, markers) is reachable again. */
export async function closeWorldControls(page: Page) {
  if (!(await isPhoneLayout(page))) return;
  const sheet = page.getByRole("dialog", { name: /^Map (filters|layers)$/ });
  if (await sheet.count()) {
    await page.keyboard.press("Escape");
    await sheet.waitFor({ state: "detached" });
  }
}
