// Static RSS 2.0 payloads for deterministic Playwright ingestion tests
// (spec §7: "Create deterministic local RSS fixtures ... so external
// network/feed changes cannot break the core suite"). Served by
// app/api/test-fixtures/rss/[name]/route.ts at a same-origin URL, so a
// test source's `url` can point at it with zero external network calls.
//
// "feed-a" is the steady-state feed: fixed guids/titles/pubDates the core
// suite asserts against directly, plus a second fetch of the same feed
// exercises the guid-based dedup path. Item text is deliberately built
// from gazetteer place names (lib/geocoding/gazetteer.ts) and
// event-type keywords (lib/ingestion/event-type-keywords.ts) so automated
// draft extraction produces predictable output.
const FEEDS: Record<string, string> = {
  "feed-a": `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
<title>Vigil Test Fixture Feed A</title>
<item>
<title>Drone strike hits fuel depot near Kyiv</title>
<link>https://fixture.test/feed-a/kyiv-drone</link>
<guid>fixture-feed-a-kyiv-drone</guid>
<pubDate>Wed, 01 Jan 2026 08:00:00 GMT</pubDate>
<description>Officials say a drone strike hit a fuel depot near Kyiv overnight, with no casualties confirmed.</description>
</item>
<item>
<title>Heavy shelling reported near Novoselivka overnight</title>
<link>https://fixture.test/feed-a/novoselivka-shelling</link>
<guid>fixture-feed-a-novoselivka-shelling</guid>
<pubDate>Wed, 01 Jan 2026 09:00:00 GMT</pubDate>
<description>Residents reported heavy artillery shelling near Novoselivka this morning.</description>
</item>
<item>
<title>Unrelated feature: local bakery wins national award</title>
<link>https://fixture.test/feed-a/bakery-award</link>
<guid>fixture-feed-a-bakery-award</guid>
<pubDate>Wed, 01 Jan 2026 07:00:00 GMT</pubDate>
<description>A small bakery has won a national culinary award for its sourdough recipe.</description>
</item>
</channel>
</rss>`,
};

export function getRssFixture(name: string): string | null {
  return FEEDS[name] ?? null;
}
