// Fixture Telegram channels for the test server only (TELEGRAM_FIXTURES=true,
// set by playwright.config.ts). They let the credential-gated Telegram adapter
// be exercised end-to-end — fetch, normalize, dedupe, aggregator handling —
// with NO network and NO real credentials. Never enabled in development or
// production, and the handles below are not real channels. Text is original.

export interface TelegramFixtureMessage {
  messageId: number;
  channel: string;
  text: string;
  /** unix seconds */
  date: number;
}

const FIXTURES: Record<string, TelegramFixtureMessage[]> = {
  // A Liveuamap-style aggregator channel: each post carries the aggregator's own
  // permalink and names or links the upstream it repeats.
  vigil_fixture_aggregator: [
    {
      messageId: 101,
      channel: "vigil_fixture_aggregator",
      date: Math.floor(new Date("2026-01-01T10:00:00Z").getTime() / 1000),
      text:
        "Fixland front: Fixtown was captured by Fixland forces after heavy fighting near the front line. Source: Fixland General Staff https://example-upstream.test/report/fixtown-101 https://liveuamap.com/en/2026/1-january-fixtown-captured",
    },
    {
      messageId: 102,
      channel: "vigil_fixture_aggregator",
      date: Math.floor(new Date("2026-01-01T11:30:00Z").getTime() / 1000),
      text: "Explosions reported near Fixcity, residents say. via Fixcity Local News https://liveuamap.com/en/2026/1-january-fixcity-explosions",
    },
    {
      messageId: 103,
      channel: "vigil_fixture_aggregator",
      date: Math.floor(new Date("2026-01-01T12:00:00Z").getTime() / 1000),
      text: "Situation update: no significant changes overnight.",
    },
  ],
};

export function getTelegramFixture(handle: string): TelegramFixtureMessage[] | null {
  return FIXTURES[handle.replace(/^@/, "")] ?? null;
}
