import { test, expect } from "@playwright/test";
import { InvalidRsshubRouteError, RsshubNotConfiguredError, isRsshubUrl, resolveFeedUrl, rsshubBaseUrl } from "@/lib/ingestion/rsshub";

// Optional RSSHub sidecar support (docs/RSSHUB_INTEGRATION.md). RSSHub is AGPL software: nothing of it lives in
// Vigil; `rsshub://<route>` is only resolved against RSSHUB_BASE_URL and then read by the normal RSSAdapter.
// The test server sets RSSHUB_BASE_URL to the local RSS fixture route.

const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

test.afterAll(async () => {
  const { prisma } = await import("@/lib/db/client");
  await prisma.source.deleteMany({ where: { name: { startsWith: "RH " } } });
});

test.describe("rsshub:// resolution (pure)", () => {
  const env = { RSSHUB_BASE_URL: "https://rsshub.example.org/" };

  test("ordinary URLs are untouched; rsshub:// routes resolve against the configured base", () => {
    expect(resolveFeedUrl("https://feeds.bbci.co.uk/news/world/rss.xml", env)).toBe("https://feeds.bbci.co.uk/news/world/rss.xml");
    expect(resolveFeedUrl("rsshub://kyodonews/en", env)).toBe("https://rsshub.example.org/kyodonews/en");
    expect(resolveFeedUrl("RSSHUB:///nhk/news/en?limit=5", env)).toBe("https://rsshub.example.org/nhk/news/en?limit=5");
    expect(resolveFeedUrl("rsshub://dw/en", { ...env, RSSHUB_BASE_URL: "http://rsshub:1200/base///" })).toBe("http://rsshub:1200/base/dw/en");
    expect(isRsshubUrl("rsshub://x")).toBe(true);
    expect(isRsshubUrl("https://x")).toBe(false);
    expect(isRsshubUrl(null)).toBe(false);
  });

  test("the access key is appended only when configured", () => {
    expect(resolveFeedUrl("rsshub://dw/en", { ...env, RSSHUB_ACCESS_KEY: "s3 cret" })).toBe("https://rsshub.example.org/dw/en?key=s3%20cret");
    expect(resolveFeedUrl("rsshub://dw/en?x=1", { ...env, RSSHUB_ACCESS_KEY: "k" })).toBe("https://rsshub.example.org/dw/en?x=1&key=k");
  });

  test("disabled when RSSHUB_BASE_URL is unset or not http(s): no hard dependency", () => {
    expect(rsshubBaseUrl({})).toBeNull();
    expect(rsshubBaseUrl({ RSSHUB_BASE_URL: "ftp://x" })).toBeNull();
    expect(rsshubBaseUrl({ RSSHUB_BASE_URL: "not a url" })).toBeNull();
    expect(() => resolveFeedUrl("rsshub://dw/en", {})).toThrow(RsshubNotConfiguredError);
    expect(resolveFeedUrl("https://example.org/feed.xml", {})).toBe("https://example.org/feed.xml"); // normal feeds never need it
  });

  test("a route can only address the configured instance: no scheme, host, traversal or protocol-relative tricks", () => {
    // Extra leading slashes are harmless: the result is still under the configured base, never a different host.
    expect(resolveFeedUrl("rsshub:////evil.example/x", env)).toBe("https://rsshub.example.org/evil.example/x");
    for (const bad of ["rsshub://../etc/passwd", "rsshub://a/../b", "rsshub://https://evil.example/x", "rsshub://a b", "rsshub://", "rsshub://a\nb"]) {
      expect(() => resolveFeedUrl(bad, env), bad).toThrow(InvalidRsshubRouteError);
    }
  });
});

test.describe("rsshub:// through the real ingestion path", () => {
  test("a source with an rsshub:// URL is fetched through the sidecar and ingested like any RSS feed", async ({ request }) => {
    const src = (await request.post("/api/admin/sources", { data: { name: `RH ${unique()}`, type: "rss", url: "rsshub://feed-a", enabled: true, autoIngest: false, autoProcessing: false, independenceClass: "independent_standard" } }).then((r) => r.json())) as { id: string };
    const first = (await request.post(`/api/admin/sources/${src.id}/fetch`).then((r) => r.json())) as { errors: number; fetched: number; new: number; alreadyKnown: number };
    expect(first.errors).toBe(0);
    expect(first.fetched).toBeGreaterThan(0);
    expect(first.new).toBe(first.fetched);
    const second = (await request.post(`/api/admin/sources/${src.id}/fetch`).then((r) => r.json())) as { errors: number; new: number };
    expect(second.errors).toBe(0);
    expect(second.new).toBe(0); // normal dedup applies
    // The stored article URLs are the publisher's, never the RSSHub URL.
    const { prisma } = await import("@/lib/db/client");
    const items = await prisma.rawIngestionItem.findMany({ where: { sourceId: src.id }, select: { originalUrl: true } });
    expect(items.length).toBeGreaterThan(0);
    for (const i of items) expect(i.originalUrl ?? "").not.toContain("test-fixtures/rss");
  });

  test("an invalid route is a recorded error, not a fetch", async ({ request }) => {
    const src = (await request.post("/api/admin/sources", { data: { name: `RH ${unique()}`, type: "rss", url: "rsshub://../../secret", enabled: true, autoIngest: false, autoProcessing: false } }).then((r) => r.json())) as { id: string };
    const res = (await request.post(`/api/admin/sources/${src.id}/fetch`).then((r) => r.json())) as { errors: number; new: number };
    expect(res.errors).toBeGreaterThan(0);
    expect(res.new).toBe(0);
    const { prisma } = await import("@/lib/db/client");
    const row = await prisma.source.findUniqueOrThrow({ where: { id: src.id } });
    expect(row.lastError ?? "").toMatch(/Invalid RSSHub route/);
  });
});
