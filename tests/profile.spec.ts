import { test, expect } from "@playwright/test";

test.describe("Profile / local account (/profile)", () => {
  test("create account, edit name, change default map, survive reload, sign out", async ({ page }) => {
    const email = `e2e-${Date.now()}@example.com`;

    await page.goto("/profile");
    await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Create Account" }).click();
    await page.getByPlaceholder("Display name").fill("E2E Tester");
    await page.getByPlaceholder("Email").fill(email);
    await page.getByPlaceholder("Password", { exact: true }).fill("e2e-password-123");
    await page.getByPlaceholder("Confirm password").fill("e2e-password-123");
    // Two "Create Account" buttons exist while the form is open: the
    // header toggle and the form's own submit button (the latter last in
    // DOM order).
    await page.getByRole("button", { name: "Create Account" }).last().click();

    await expect(page.getByRole("heading", { name: "E2E Tester" })).toBeVisible();
    await expect(page.getByText(email)).toBeVisible();

    // Edit display name.
    await page.getByRole("button", { name: "Edit Profile" }).click();
    const nameInput = page.getByLabel("Display name");
    await nameInput.fill("E2E Tester Renamed");
    await page.getByRole("button", { name: "Save Changes" }).click();
    await expect(page.getByRole("heading", { name: "E2E Tester Renamed" })).toBeVisible();

    // Default map mode.
    const mapGroup = page.getByRole("radiogroup", { name: "Default map mode" });
    await mapGroup.getByRole("radio", { name: "Satellite" }).click();
    await expect(mapGroup.getByRole("radio", { name: "Satellite" })).toHaveAttribute("aria-checked", "true");

    // Reload: session + preferences must both survive.
    await page.reload();
    await expect(page.getByRole("heading", { name: "E2E Tester Renamed" })).toBeVisible();
    await expect(page.getByText(email)).toBeVisible();
    await expect(
      page.getByRole("radiogroup", { name: "Default map mode" }).getByRole("radio", { name: "Satellite" }),
    ).toHaveAttribute("aria-checked", "true");

    // Default map mode actually drives /world.
    await page.goto("/world");
    await expect(
      page.getByRole("radiogroup", { name: "Basemap" }).getByRole("radio", { name: "Satellite" }),
    ).toHaveAttribute("aria-checked", "true");

    // Sign out.
    await page.goto("/profile");
    await page.getByRole("button", { name: "Sign Out" }).click();
    await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Create Account" })).toBeVisible();
  });

  test("sign-in rejects a wrong password and accepts the correct one", async ({ page }) => {
    const email = `e2e-signin-${Date.now()}@example.com`;

    await page.goto("/profile");
    await page.getByRole("button", { name: "Create Account" }).click();
    await page.getByPlaceholder("Display name").fill("Sign In Tester");
    await page.getByPlaceholder("Email").fill(email);
    await page.getByPlaceholder("Password", { exact: true }).fill("correct-password");
    await page.getByPlaceholder("Confirm password").fill("correct-password");
    await page.getByRole("button", { name: "Create Account" }).last().click();
    await expect(page.getByRole("heading", { name: "Sign In Tester" })).toBeVisible();

    await page.getByRole("button", { name: "Sign Out" }).click();

    await page.getByRole("button", { name: "Sign In" }).click();
    await page.getByPlaceholder("Email").fill(email);
    await page.getByPlaceholder("Password").fill("wrong-password");
    await page.getByRole("button", { name: "Sign In" }).last().click();
    await expect(page.getByText(/No matching local account/)).toBeVisible();

    await page.getByPlaceholder("Password").fill("correct-password");
    await page.getByRole("button", { name: "Sign In" }).last().click();
    await expect(page.getByRole("heading", { name: "Sign In Tester" })).toBeVisible();
  });
});
