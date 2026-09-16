import type { Source } from "@prisma/client";
import type { SourceAdapter, NormalizedItem, HealthCheckResult } from "@/lib/ingestion/types";

/**
 * Placeholder only — per the build spec §6 (Telegram source preparation):
 * "Do NOT implement generic unauthorized Telegram scraping.
 * TelegramAuthorizedSourceAdapter should remain disabled unless valid
 * Telegram API credentials/session and appropriate source permission/
 * compliant access are provided." See also Open Questions.md in the
 * Obsidian vault.
 *
 * No Telegram API client is wired up. fetchLatest() always returns []
 * and healthCheck() always reports disabled, regardless of a source's
 * `enabled` flag, until real credentials are configured here.
 */
const TELEGRAM_CREDENTIALS_CONFIGURED = false;

export const TelegramAuthorizedSourceAdapter: SourceAdapter = {
  async fetchLatest(): Promise<unknown[]> {
    if (!TELEGRAM_CREDENTIALS_CONFIGURED) return [];
    throw new Error("Telegram adapter has no credential-handling implementation yet.");
  },

  normalize(raw: unknown): NormalizedItem {
    // Unreachable while TELEGRAM_CREDENTIALS_CONFIGURED is false, but typed
    // so the adapter satisfies SourceAdapter and is ready to fill in.
    const item = raw as Partial<NormalizedItem>;
    return { externalId: item.externalId ?? crypto.randomUUID(), ...item };
  },

  async healthCheck(source: Source): Promise<HealthCheckResult> {
    return {
      ok: false,
      message: TELEGRAM_CREDENTIALS_CONFIGURED
        ? "Configured but not implemented."
        : `Telegram adapter disabled — no authorized credentials configured (source: ${source.telegramHandle ?? source.name}).`,
    };
  },
};
