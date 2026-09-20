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
  // MilitaryLand Phase 1 (tests/militaryland.spec.ts) — deliberately
  // written fresh for this fixture, not copied from any real MilitaryLand
  // article; only the entity NAMES (unit designations, a rank+name,
  // an equipment model) are real, verified facts, chosen so
  // lib/military/extract-entities.ts's deterministic patterns reliably
  // match: an ordinal-numbered unit, a ranked commander name, and a
  // cataloged equipment model, each appearing twice across the two items
  // to exercise entity-dedup (same MilitaryUnit/Commander row reused, not
  // duplicated, per findOrCreateMilitaryUnit &c.).
  "militaryland-feed": `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
<title>Vigil Test Fixture — MilitaryLand-style Feed</title>
<item>
<title>25th Airborne Brigade receives new Bohdana artillery systems</title>
<link>https://fixture.test/militaryland/25th-airborne-bohdana</link>
<guid>fixture-militaryland-25th-airborne-bohdana</guid>
<pubDate>Wed, 01 Jan 2026 08:00:00 GMT</pubDate>
<description>The 25th Airborne Brigade has taken delivery of several 2P22 Bohdana self-propelled guns, according to unit sources. Brigadier General Svyatoslav Zaits welcomed the delivery during a visit to the brigade's staging area.</description>
</item>
<item>
<title>Zaits reviews 25th Airborne Brigade readiness</title>
<link>https://fixture.test/militaryland/zaits-readiness-review</link>
<guid>fixture-militaryland-zaits-readiness-review</guid>
<pubDate>Wed, 01 Jan 2026 09:00:00 GMT</pubDate>
<description>Brigadier General Svyatoslav Zaits conducted a readiness review of the 25th Airborne Brigade this week, inspecting newly fielded 2P22 Bohdana batteries.</description>
</item>
</channel>
</rss>`,
  // Myanmar specialist-source tests (tests/myanmar.spec.ts) — original text
  // written for this fixture. Mirrors the structure of a real Myanmar Now
  // WordPress feed: dc:creator bylines, <category> tags, and a "paid content"
  // category on the paywalled item. Item 1 carries a control-change phrase,
  // item 2 is paywalled, item 3 repeats an actor already named in item 1.
  "myanmar-now-feed": `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/">
<channel>
<title>Vigil Test Fixture — Myanmar Now-style Feed</title>
<item>
<title>Junta retakes Kyaukme from resistance forces</title>
<link>https://fixture.test/myanmar-now/kyaukme-retaken</link>
<dc:creator><![CDATA[Fixture Reporter One]]></dc:creator>
<pubDate>Wed, 01 Jan 2026 08:00:00 GMT</pubDate>
<category><![CDATA[Myanmar]]></category>
<category><![CDATA[News]]></category>
<guid isPermaLink="false">fixture-myanmar-now-kyaukme-retaken</guid>
<description><![CDATA[Local residents say the Tatmadaw recaptured Kyaukme from KNDF after several days of fighting near the town.]]></description>
</item>
<item>
<title>Subscriber report on displacement in Sagaing</title>
<link>https://fixture.test/myanmar-now/sagaing-displacement</link>
<dc:creator><![CDATA[Fixture Reporter Two]]></dc:creator>
<pubDate>Wed, 01 Jan 2026 09:00:00 GMT</pubDate>
<category><![CDATA[Myanmar]]></category>
<category><![CDATA[paid content]]></category>
<guid isPermaLink="false">fixture-myanmar-now-sagaing-displacement</guid>
<description><![CDATA[Preview: families flee villages in Sagaing as clashes continue.]]></description>
</item>
<item>
<title>Tatmadaw airstrike reported near Sittwe</title>
<link>https://fixture.test/myanmar-now/sittwe-airstrike</link>
<dc:creator><![CDATA[Fixture Reporter One]]></dc:creator>
<pubDate>Wed, 01 Jan 2026 10:00:00 GMT</pubDate>
<category><![CDATA[Myanmar]]></category>
<guid isPermaLink="false">fixture-myanmar-now-sittwe-airstrike</guid>
<description><![CDATA[An airstrike attributed to the Tatmadaw hit a village outside Sittwe, residents said.]]></description>
</item>
</channel>
</rss>`,
  // Territorial Change Intelligence tests (tests/territorial-changes.spec.ts) —
  // original text. Feed A: a capture with a named previous controller, a
  // withdrawal, a "fighting for control" contested case, an area-level
  // (township) capture, and two non-territorial sentences that must NOT
  // produce candidates. Feed B (separate URLs): restates the Paletwa capture
  // (corroboration) and makes a CONFLICTING claim about the same town.
  "territorial-change-feed": `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
<title>Vigil Test Fixture — Territorial Change Feed A</title>
<item>
<title>Arakan Army says it now holds Paletwa</title>
<link>https://fixture.test/territorial/paletwa-captured</link>
<guid>fixture-territorial-paletwa-captured</guid>
<pubDate>Wed, 01 Jan 2026 08:00:00 GMT</pubDate>
<description>The Arakan Army seized control of Paletwa from the Tatmadaw after several days of fighting, local residents said.</description>
</item>
<item>
<title>Junta pulls out of Buthidaung</title>
<link>https://fixture.test/territorial/buthidaung-withdrawal</link>
<guid>fixture-territorial-buthidaung-withdrawal</guid>
<pubDate>Wed, 01 Jan 2026 09:00:00 GMT</pubDate>
<description>The Tatmadaw withdrew from Buthidaung amid clashes with Arakan Army fighters.</description>
</item>
<item>
<title>Battle for Kyaukphyu drags on</title>
<link>https://fixture.test/territorial/kyaukphyu-contested</link>
<guid>fixture-territorial-kyaukphyu-contested</guid>
<pubDate>Wed, 01 Jan 2026 10:00:00 GMT</pubDate>
<description>Fighting for control of Kyaukphyu continues between the Tatmadaw and the Arakan Army.</description>
</item>
<item>
<title>KNLA fighters reportedly enter Myawaddy township</title>
<link>https://fixture.test/territorial/myawaddy-township</link>
<guid>fixture-territorial-myawaddy-township</guid>
<pubDate>Wed, 01 Jan 2026 11:00:00 GMT</pubDate>
<description>KNLA fighters took control of Myawaddy township, reportedly after the Tatmadaw garrison left.</description>
</item>
<item>
<title>Documentary about the war wins acclaim</title>
<link>https://fixture.test/territorial/documentary</link>
<guid>fixture-territorial-documentary</guid>
<pubDate>Wed, 01 Jan 2026 12:00:00 GMT</pubDate>
<description>A new documentary captured the imagination of viewers across Myanmar. Its director seized the opportunity to speak about the war.</description>
</item>
<item>
<title>Training accident reported</title>
<link>https://fixture.test/territorial/training-accident</link>
<guid>fixture-territorial-training-accident</guid>
<pubDate>Wed, 01 Jan 2026 13:00:00 GMT</pubDate>
<description>A Tatmadaw pilot lost control of the aircraft during a training flight near the airbase.</description>
</item>
</channel>
</rss>`,
  "territorial-change-feed-b": `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
<title>Vigil Test Fixture — Territorial Change Feed B</title>
<item>
<title>Paletwa taken, residents say</title>
<link>https://fixture.test/territorial/paletwa-second-report</link>
<guid>fixture-territorial-paletwa-second-report</guid>
<pubDate>Wed, 01 Jan 2026 14:00:00 GMT</pubDate>
<description>The Arakan Army took control of Paletwa on Tuesday, according to residents and fighters in the area.</description>
</item>
<item>
<title>State media disputes Paletwa claim</title>
<link>https://fixture.test/territorial/paletwa-counterclaim</link>
<guid>fixture-territorial-paletwa-counterclaim</guid>
<pubDate>Wed, 01 Jan 2026 15:00:00 GMT</pubDate>
<description>The Tatmadaw seized control of Paletwa from Arakan Army fighters, state media claimed.</description>
</item>
</channel>
</rss>`,
  // Coverage-Driven Source Expansion tests (tests/source-expansion.spec.ts) —
  // original text. Mimics real regional feeds' quirks: EMPTY <guid> elements
  // (every item must still dedupe by its own link), Dublin Core dates instead of
  // pubDate, numeric character references, and a dc:creator byline. Item 1 states
  // a territorial claim in the active voice; the aggregator fixture channel
  // states the same claim, so the two share one claim key.
  "expansion-local-feed": `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/">
<channel>
<title>Vigil Test Fixture — Local Outlet</title>
<item>
<title>Fixland forces captured Fixtown after fighting</title>
<link>https://fixture.test/expansion/local/fixtown-captured</link>
<guid isPermaLink="false"></guid>
<dc:creator><![CDATA[Fixture Local Reporter]]></dc:creator>
<pubDate>Thu, 01 Jan 2026 13:00:00 GMT</pubDate>
<description><![CDATA[Fixland forces captured Fixtown after fighting on the outskirts, residents said.]]></description>
</item>
<item>
<title>Caf&#233; owners return to Fixcity market</title>
<link>https://fixture.test/expansion/local/fixcity-market</link>
<guid isPermaLink="false"></guid>
<dc:date>2026-01-01T14:00:00Z</dc:date>
<description>Traders reopened stalls in Fixcity on Thursday.</description>
</item>
<item>
<title>Fixland army shelling reported near Fixridge</title>
<link>https://fixture.test/expansion/local/fixridge-shelling</link>
<guid isPermaLink="false"></guid>
<pubDate>Thu, 01 Jan 2026 15:00:00 GMT</pubDate>
<description>Artillery shelling was reported near Fixridge overnight.</description>
</item>
</channel>
</rss>`,
  "expansion-specialist-feed": `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/">
<channel>
<title>Vigil Test Fixture — Specialist Monitor</title>
<item>
<title>Monitor brief: front-line assessment for the Fixland theatre</title>
<link>https://fixture.test/expansion/specialist/fixland-assessment</link>
<guid>fixture-expansion-specialist-assessment</guid>
<dc:creator><![CDATA[Fixture Analyst]]></dc:creator>
<pubDate>Thu, 01 Jan 2026 16:00:00 GMT</pubDate>
<description>An assessment of recent fighting near the front line.</description>
</item>
</channel>
</rss>`,
  "plugin-nolink-feed": `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
<title>Vigil Test Fixture — Source Identity</title>
<link>https://fixture.test/plugin-site/</link>
<item>
<title>Story with its own article link</title>
<link>https://fixture.test/plugin-site/articles/story-one</link>
<guid>fixture-plugin-story-one</guid>
<pubDate>Thu, 01 Jan 2026 09:00:00 GMT</pubDate>
<description>A report with a proper article URL.</description>
</item>
<item>
<title>Story the publisher gave no link for</title>
<guid>fixture-plugin-story-two</guid>
<pubDate>Thu, 01 Jan 2026 10:00:00 GMT</pubDate>
<description>A report whose item has no link element at all.</description>
</item>
</channel>
</rss>`,
};

export function getRssFixture(name: string): string | null {
  return FEEDS[name] ?? null;
}
