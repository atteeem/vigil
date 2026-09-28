import fs from "node:fs";
import path from "node:path";
import { test, expect } from "@playwright/test";
import { ADMIN_TEST_BYPASS_SECRET } from "./fixtures/admin-test-bypass";

// Pre-Launch Critical Correctness & Security v1 — admin auth section. Every other spec in this suite runs
// with the x-admin-test-bypass header set globally (playwright.config.ts's extraHTTPHeaders), so THIS is
// the one spec that deliberately drops it to exercise the real, unauthenticated path against
// middleware.ts + lib/admin/auth.ts.
test.use({ extraHTTPHeaders: {} });

// Enumerates every real app/api/admin/**/route.ts file on disk (excluding login/logout, which middleware
// intentionally leaves open) and derives its request path — so this test covers the ENTIRE admin API
// surface as it exists right now, not a hand-picked sample, and automatically covers any admin route
// added later.
function adminApiPaths(): string[] {
  const root = path.join(__dirname, "..", "app", "api", "admin");
  const paths: string[] = [];
  function walk(dir: string, segments: string[]) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        walk(path.join(dir, entry.name), [...segments, entry.name]);
      } else if (entry.name === "route.ts") {
        // Dynamic segments ([id], [proposalId], ...) get a placeholder value — middleware authorizes by
        // path shape only, never touches params, so the exact value is irrelevant to what's under test.
        const urlSegments = segments.map((s) => (s.startsWith("[") && s.endsWith("]") ? "test-id" : s));
        paths.push(`/api/admin/${urlSegments.join("/")}`);
      }
    }
  }
  walk(root, []);
  return paths.filter((p) => p !== "/api/admin/login" && p !== "/api/admin/logout");
}

test.describe("Admin surface authorization (middleware.ts + lib/admin/auth.ts)", () => {
  test("1. every real /api/admin/* route rejects an anonymous GET with 401", async ({ request }) => {
    const targets = adminApiPaths();
    expect(targets.length).toBeGreaterThan(50); // sanity check that enumeration actually found the real routes
    for (const target of targets) {
      const res = await request.get(target);
      expect(res.status(), `${target} should reject anonymous GET`).toBe(401);
    }
  });

  test("2. anonymous POST/PATCH/DELETE mutation attempts are rejected and never perform work", async ({ request }) => {
    const postRes = await request.post("/api/admin/sources", { data: { name: "SSRF probe", type: "rss", url: "https://example.com/feed" } });
    expect(postRes.status()).toBe(401);

    const patchRes = await request.patch("/api/admin/sources/test-id", { data: { name: "renamed" } });
    expect(patchRes.status()).toBe(401);

    const deleteRes = await request.delete("/api/admin/sources/test-id");
    expect(deleteRes.status()).toBe(401);

    // The POST above must not have created a Source despite returning 401.
    const listRes = await request.get("/api/admin/sources", { headers: { "x-admin-test-bypass": ADMIN_TEST_BYPASS_SECRET } });
    expect(listRes.ok()).toBe(true);
    const sources = (await listRes.json()) as Array<{ name: string }>;
    expect(sources.some((s) => s.name === "SSRF probe")).toBe(false);
  });

  test("3. an authorized request (test bypass) succeeds", async ({ request }) => {
    const res = await request.get("/api/admin/sources", { headers: { "x-admin-test-bypass": ADMIN_TEST_BYPASS_SECRET } });
    expect(res.ok()).toBe(true);
  });

  test("3b. a real login issues a session cookie that then authorizes admin requests", async ({ request }) => {
    const password = process.env.ADMIN_PASSWORD;
    test.skip(!password, "ADMIN_PASSWORD not set for this run — covered by the test-bypass case instead.");
    const loginRes = await request.post("/api/admin/login", { data: { password } });
    expect(loginRes.ok()).toBe(true);
    const res = await request.get("/api/admin/sources");
    expect(res.ok()).toBe(true);
  });

  test("4. normal public APIs remain accessible without any admin credential", async ({ request }) => {
    const directory = await request.get("/api/conflicts/directory");
    expect(directory.ok()).toBe(true);
    const commandCenter = await request.get("/api/world/command-center");
    expect(commandCenter.ok()).toBe(true);
  });

  test("5. /admin pages redirect an anonymous browser to /admin/login", async ({ page }) => {
    await page.goto("/admin/sources");
    await expect(page).toHaveURL(/\/admin\/login/);
  });

  test("6. the test bypass itself requires the exact secret, not just any header value", async ({ request }) => {
    const res = await request.get("/api/admin/sources", { headers: { "x-admin-test-bypass": "wrong-value" } });
    expect(res.status()).toBe(401);
  });
});
