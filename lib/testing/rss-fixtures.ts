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

  // A second, independent feed (distinct guids/content from feed-a) for
  // multi-source ingestion tests — polling two sources in the same
  // scheduler tick, confirming they don't cross-contaminate each other's
  // dedup or item counts.
  "feed-b": `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
<title>Vigil Test Fixture Feed B</title>
<item>
<title>Naval incident reported near Odesa port</title>
<link>https://fixture.test/feed-b/odesa-naval</link>
<guid>fixture-feed-b-odesa-naval</guid>
<pubDate>Wed, 01 Jan 2026 10:00:00 GMT</pubDate>
<description>Maritime authorities reported a naval incident near Odesa port this morning.</description>
</item>
<item>
<title>Diplomatic talks scheduled in Geneva</title>
<link>https://fixture.test/feed-b/geneva-talks</link>
<guid>fixture-feed-b-geneva-talks</guid>
<pubDate>Wed, 01 Jan 2026 11:00:00 GMT</pubDate>
<description>Officials announced a new round of diplomatic talks scheduled to take place in Geneva.</description>
</item>
</channel>
</rss>`,
};

export function getRssFixture(name: string): string | null {
  return FEEDS[name] ?? null;
}
