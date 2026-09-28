import type { SourceAdapter } from "@/lib/ingestion/types";
import type { SourceType } from "@/lib/types/db";
import { RSSAdapter } from "@/lib/ingestion/rss-adapter";
import { ManualSourceAdapter } from "@/lib/ingestion/manual-adapter";
import { TelegramAuthorizedSourceAdapter } from "@/lib/ingestion/telegram-adapter";
import { safeFetch } from "@/lib/security/safe-fetch";
import { isLocalFixtureUrl, fetchLocalFixture } from "@/lib/testing/local-fixture-transport";

// Structured sensor/official feeds bypass the news adapter path entirely (lib/hazards/poll.ts is
// dispatched from pollSource); this entry only satisfies the registry's exhaustive type.
const StructuredSourceAdapter: SourceAdapter = {
  async fetchLatest() {
    throw new Error("Structured sources are polled by the hazard pipeline, not the news adapters");
  },
  normalize() {
    throw new Error("Structured sources have no news items");
  },
  async healthCheck(source) {
    const url = source.feedUrl ?? source.url;
    if (!url) return { ok: false, message: "No feed URL configured." };
    try {
      const headers = { "User-Agent": "Vigil/1.0 (public intelligence map)" };
      const res = isLocalFixtureUrl(url) ? await fetchLocalFixture(url, { method: "GET" }) : await safeFetch(url, { method: "GET", headers });
      return res.ok ? { ok: true } : { ok: false, message: `HTTP ${res.status}` };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : "Fetch failed" };
    }
  },
};

export const ADAPTERS: Record<SourceType, SourceAdapter> = {
  rss: RSSAdapter,
  manual: ManualSourceAdapter,
  telegram: TelegramAuthorizedSourceAdapter,
  structured: StructuredSourceAdapter,
};

export function getAdapter(type: string): SourceAdapter {
  const adapter = ADAPTERS[type as SourceType];
  if (!adapter) throw new Error(`No ingestion adapter registered for source type "${type}"`);
  return adapter;
}
