import type { Source } from "@prisma/client";
import type { SourceAdapter, NormalizedItem, HealthCheckResult } from "@/lib/ingestion/types";
import { getTelegramFixture } from "@/lib/testing/telegram-fixtures";

/**
 * Real MTProto integration (spec "Telegram architecture"), entirely
 * credential-gated — per Decisions.md "Source verification" and the build
 * spec: "Do NOT implement generic unauthorized Telegram scraping."
 * fetchLatest()/healthCheck() report disabled until all three env vars
 * are set; nothing here ever falls back to scraping https://t.me or any
 * other unauthorized method.
 *
 * Credentials come from TELEGRAM_API_ID / TELEGRAM_API_HASH /
 * TELEGRAM_SESSION (see .env.example) — obtained once via teleproto's own
 * interactive login flow (README "Connecting to Telegram") and never
 * committed; only the resulting session string is needed at runtime.
 *
 * NOT verified end-to-end against live Telegram in this environment (no
 * credentials available here) — this is the intended state per the spec's
 * own framing ("so it can later operate when valid credentials... are
 * supplied"). The client library (teleproto, an actively-maintained
 * GramJS fork) is well-established and its documented `getMessages` call
 * is used exactly as documented; still, treat this as the first thing to
 * validate once real credentials are configured.
 */
/** Test-server-only fixture channels (never set in dev/production): lets the
 * adapter be tested end-to-end without credentials or network. */
function fixtureMode(): boolean {
  return process.env.TELEGRAM_FIXTURES === "true" && process.env.NODE_ENV !== "production";
}

function credentialsConfigured(): boolean {
  return Boolean(process.env.TELEGRAM_API_ID && process.env.TELEGRAM_API_HASH && process.env.TELEGRAM_SESSION);
}

interface TelegramClientLike {
  connect(): Promise<unknown>;
  getMe(): Promise<unknown>;
  getMessages(entity: string, params: { limit: number }): Promise<TelegramMessageLike[]>;
}

interface TelegramMessageLike {
  id: number;
  date: number; // unix seconds
  message?: string;
}

// Lazily imported (only when credentials exist) so `teleproto` is never
// pulled into the module graph for the common case of no Telegram
// credentials configured, and a fresh client/connection is reused across
// polls within this server process rather than reconnecting every time.
let clientPromise: Promise<TelegramClientLike> | null = null;

async function getClient(): Promise<TelegramClientLike> {
  if (!clientPromise) {
    clientPromise = (async () => {
      const { TelegramClient } = await import("teleproto");
      const { StringSession } = await import("teleproto/sessions");
      const client = new TelegramClient(
        new StringSession(process.env.TELEGRAM_SESSION!),
        Number(process.env.TELEGRAM_API_ID),
        process.env.TELEGRAM_API_HASH!,
        { connectionRetries: 3 },
      );
      await client.connect();
      return client as unknown as TelegramClientLike;
    })().catch((err) => {
      clientPromise = null; // let the next call retry rather than caching a dead connection
      throw err;
    });
  }
  return clientPromise;
}

interface TelegramRawItem {
  messageId: number;
  channel: string;
  text: string;
  date: number;
}

const MESSAGES_PER_POLL = 20;

export const TelegramAuthorizedSourceAdapter: SourceAdapter = {
  async fetchLatest(source: Source): Promise<unknown[]> {
    if (fixtureMode() && source.telegramHandle) {
      const fixture = getTelegramFixture(source.telegramHandle);
      if (fixture) return fixture.filter((m) => m.text).map((m) => ({ messageId: m.messageId, channel: m.channel, text: m.text, date: m.date }));
    }
    if (!credentialsConfigured() || !source.telegramHandle) return [];
    const client = await getClient();
    const handle = source.telegramHandle.replace(/^@/, "");
    const messages = await client.getMessages(handle, { limit: MESSAGES_PER_POLL });
    const items: TelegramRawItem[] = [];
    for (const m of messages) {
      if (!m.message) continue; // skip service messages (joins, pins, media-only posts with no caption)
      items.push({ messageId: m.id, channel: handle, text: m.message, date: m.date });
    }
    return items;
  },

  normalize(raw: unknown, source: Source): NormalizedItem {
    const item = raw as TelegramRawItem;
    return {
      // Message id is stable and unique per channel — the natural
      // dedup key, same role the RSS adapter's guid plays.
      externalId: String(item.messageId),
      originalUrl: `https://t.me/${item.channel}/${item.messageId}`,
      originalTitle: item.text.slice(0, 120),
      originalText: item.text,
      language: source.language ?? undefined,
      publishedAt: new Date(item.date * 1000),
      rawMetadata: { channel: item.channel, messageId: item.messageId },
    };
  },

  async healthCheck(source: Source): Promise<HealthCheckResult> {
    if (fixtureMode() && source.telegramHandle && getTelegramFixture(source.telegramHandle)) return { ok: true };
    if (!credentialsConfigured()) {
      return {
        ok: false,
        message: `Telegram adapter disabled — no authorized credentials configured (source: ${source.telegramHandle ?? source.name}). Set TELEGRAM_API_ID / TELEGRAM_API_HASH / TELEGRAM_SESSION.`,
      };
    }
    try {
      const client = await getClient();
      await client.getMe();
      return { ok: true };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : "Telegram health check failed" };
    }
  },
};
