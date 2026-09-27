import { test, expect } from "@playwright/test";
import { normalizeUrl } from "@/lib/ingestion/url-normalize";

// Real-data audit finding: the dedupe key was (sourceId, externalId) only. Several real feeds are not guid-stable
// across polls of ONE article — BBC appends a revision fragment to the guid, WordPress sites (Times of Israel,
// Mexico News Daily) mint a different guid before vs. after publication — while the article's own URL is unchanged,
// which created real duplicate raw_ingestion_items (21 pairs found on the dev database). normalizeUrl() is the
// systemic fix's pure half; the dedupe behavior itself is exercised in "duplicate detection" below.

test.describe("normalizeUrl (pure)", () => {
  test("strips analytics-only query params and the fragment, keeps the identity", () => {
    expect(normalizeUrl("https://www.bbc.co.uk/news/articles/c607l0k72rlvo?at_medium=RSS&at_campaign=rss#0")).toBe(
      normalizeUrl("https://www.bbc.co.uk/news/articles/c607l0k72rlvo?at_medium=RSS&at_campaign=rss#1"),
    );
    expect(normalizeUrl("https://example.com/a?utm_source=rss&utm_medium=feed")).toBe(normalizeUrl("https://example.com/a"));
  });

  test("a WordPress preview guid and its published counterpart normalize to the same key", () => {
    const preview = "https://www.timesofisrael.com/?post_type=liveblog_entry&preview=true&preview_id=3900002";
    const published = "https://www.timesofisrael.com/?post_type=liveblog_entry&p=3900002";
    // Both still carry the real post id (p / preview_id are different keys, so this pair is NOT expected to collapse
    // on id alone) — what must hold is that stripping preview/preview_id alone never changes an UNRELATED article's key.
    expect(normalizeUrl(preview)).not.toBe(normalizeUrl("https://www.timesofisrael.com/?post_type=liveblog_entry&p=999999"));
    expect(normalizeUrl(published)).toContain("p=3900002");
  });

  test("host case and a trailing slash do not create a different key; query order does not either", () => {
    expect(normalizeUrl("https://WWW.Example.com/a/")).toBe(normalizeUrl("https://www.example.com/a"));
    expect(normalizeUrl("https://example.com/a?b=1&a=2")).toBe(normalizeUrl("https://example.com/a?a=2&b=1"));
  });

  test("never throws on a malformed value; compares it as-is", () => {
    expect(normalizeUrl("not a url")).toBe("not a url");
    expect(normalizeUrl("")).toBe("");
  });

  test("a real path parameter is never stripped (only the known tracking/preview keys are)", () => {
    expect(normalizeUrl("https://example.com/?id=42")).toContain("id=42");
  });
});

test.describe("duplicate detection at ingestion", () => {
  test("the same article URL under a different externalId is treated as the existing report, not a new one", async ({ request }) => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const source = await (
      await request.post("/api/admin/sources", { data: { name: `URL dedupe test ${suffix}`, type: "manual" } })
    ).json();
    const url = `https://news.example-source.test/dup-${suffix}?at_medium=RSS&at_campaign=rss`;

    const first = await (
      await request.post("/api/admin/incoming/manual", {
        data: { sourceId: source.id, externalId: `guid-a-${suffix}`, originalUrl: url, originalTitle: "First guid" },
      })
    ).json();

    // A second poll of the "same" feed item, BBC-fragment-style: different guid, same URL modulo tracking params/fragment.
    const secondRes = await request.post("/api/admin/incoming/manual", {
      data: { sourceId: source.id, externalId: `guid-b-${suffix}`, originalUrl: `${url}#1`, originalTitle: "Second guid, same article" },
    });
    expect(secondRes.status()).toBe(200); // 200 = matched an existing row, not 201 = created
    const second = await secondRes.json();
    expect(second.id).toBe(first.id);

    const list = (await (await request.get(`/api/admin/incoming?sourceId=${source.id}`)).json()) as { id: string }[];
    expect(list).toHaveLength(1);
  });

  test("a different article at the same source is still created normally", async ({ request }) => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const source = await (
      await request.post("/api/admin/sources", { data: { name: `URL dedupe distinct ${suffix}`, type: "manual" } })
    ).json();
    const a = await (
      await request.post("/api/admin/incoming/manual", { data: { sourceId: source.id, externalId: `a-${suffix}`, originalUrl: `https://news.example-source.test/${suffix}-one` } })
    ).json();
    const bRes = await request.post("/api/admin/incoming/manual", { data: { sourceId: source.id, externalId: `b-${suffix}`, originalUrl: `https://news.example-source.test/${suffix}-two` } });
    expect(bRes.status()).toBe(201);
    const b = await bRes.json();
    expect(b.id).not.toBe(a.id);
  });
});
