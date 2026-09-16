import type { SourceAdapter } from "@/lib/ingestion/types";
import type { SourceType } from "@/lib/types/db";
import { RSSAdapter } from "@/lib/ingestion/rss-adapter";
import { ManualSourceAdapter } from "@/lib/ingestion/manual-adapter";
import { TelegramAuthorizedSourceAdapter } from "@/lib/ingestion/telegram-adapter";

export const ADAPTERS: Record<SourceType, SourceAdapter> = {
  rss: RSSAdapter,
  manual: ManualSourceAdapter,
  telegram: TelegramAuthorizedSourceAdapter,
};

export function getAdapter(type: string): SourceAdapter {
  const adapter = ADAPTERS[type as SourceType];
  if (!adapter) throw new Error(`No ingestion adapter registered for source type "${type}"`);
  return adapter;
}
