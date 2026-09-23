import { expect, type Page } from "@playwright/test";

// Territorial Control is chosen dataset by dataset: the toggle opens a selector that lists only datasets with published
// geometry, and nothing is drawn until one is ticked. These helpers keep the older map specs, which just want "the
// territory on" or "off", independent of how many datasets other specs left in the shared test database.

/** Opens the selector, ticks every available dataset (or those whose name contains `only`), closes it. */
export async function enableTerritory(page: Page, only?: string) {
  const btn = page.getByTestId("territorial-toggle");
  if ((await btn.getAttribute("aria-expanded")) !== "true") await btn.click();
  const list = page.getByTestId("territory-dataset-list");
  await expect(list).toBeVisible();
  const boxes = list.locator('input[type="checkbox"]');
  const n = await boxes.count();
  for (let i = 0; i < n; i++) {
    const box = boxes.nth(i);
    const label = (await box.getAttribute("aria-label")) ?? "";
    if (only && !label.includes(only)) continue;
    if (!(await box.isChecked())) await box.check();
  }
  await expect(btn).toHaveAttribute("aria-pressed", "true");
  await page.getByLabel("Close territorial control panel").click();
}

/** Unticks every dataset and closes the selector: nothing is drawn. */
export async function disableTerritory(page: Page) {
  const btn = page.getByTestId("territorial-toggle");
  if ((await btn.getAttribute("aria-expanded")) !== "true") await btn.click();
  const boxes = page.getByTestId("territory-dataset-list").locator('input[type="checkbox"]');
  const n = await boxes.count();
  for (let i = 0; i < n; i++) if (await boxes.nth(i).isChecked()) await boxes.nth(i).uncheck();
  await expect(btn).toHaveAttribute("aria-pressed", "false");
  await page.getByLabel("Close territorial control panel").click();
}
