import type { Page } from "@playwright/test";

// /world keeps the map clear on every viewport. Phones collapse the timeline to a chip and open the filter / layer
// controls in bottom sheets; desktop collapses everything into one command bar whose buttons open ONE panel at a
// time beneath it. Specs that operate those controls call these helpers.
//
//   which      desktop panel (command-bar button)         phone
//   "filters"  Filters: event type + region               Filters sheet (also holds the "Time" range)
//   "map"      Map mode: basemap + Markers/Heatmap        Layers sheet
//   "layers"   Layers: territorial control + hazards      Layers sheet
//   "timeline" Timeline: Live / historical + playback     timeline panel under the chip row
//
// The "Time" range (1H/6H/24H/7D) is always visible in the desktop bar and needs no helper there.

export type WorldControls = "filters" | "layers" | "map" | "timeline";

const DESKTOP_BUTTON: Record<WorldControls, string> = {
  filters: "map-filters-button",
  layers: "map-layers-button",
  map: "map-mode-button",
  timeline: "timeline-toggle",
};

const isPhoneLayout = (page: Page) => page.getByTestId("mobile-map-controls").isVisible();

export async function openWorldControls(page: Page, which: WorldControls) {
  await page.getByRole("application", { name: "Operational conflict map" }).waitFor();
  if (!(await isPhoneLayout(page))) {
    const panel = page.locator(`[data-testid="map-control-panel"][data-panel="${which}"]`);
    if (await panel.count()) return; // already open
    await page.getByTestId(DESKTOP_BUTTON[which]).click();
    await panel.waitFor();
    return;
  }
  if (which === "timeline") {
    if (!(await page.getByTestId("mobile-timeline-panel").isVisible())) await page.getByTestId("mobile-timeline-toggle").click();
    return;
  }
  const sheetKind = which === "filters" ? "filters" : "layers"; // the phone Layers sheet also holds the map mode
  const sheet = page.getByRole("dialog", { name: sheetKind === "filters" ? "Map filters" : "Map layers" });
  if (await sheet.count()) return; // already open
  await closeWorldControls(page); // the other sheet
  await page.getByTestId(sheetKind === "filters" ? "mobile-filters-button" : "mobile-layers-button").click();
  await sheet.waitFor();
}

/** Closes an open control panel (desktop) or sheet (phone) so the map (legend, markers) is reachable again. */
export async function closeWorldControls(page: Page) {
  if (!(await isPhoneLayout(page))) {
    const panel = page.getByTestId("map-control-panel");
    if (await panel.count()) {
      await page.keyboard.press("Escape");
      await panel.waitFor({ state: "detached" });
    }
    return;
  }
  const sheet = page.getByRole("dialog", { name: /^Map (filters|layers)$/ });
  if (await sheet.count()) {
    await page.keyboard.press("Escape");
    await sheet.waitFor({ state: "detached" });
  }
}
