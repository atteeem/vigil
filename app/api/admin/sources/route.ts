import { NextResponse } from "next/server";
import { listSources, createSource, type SourceInput } from "@/lib/db/repositories/sources";
import { getDailyIngestionStatsBySource } from "@/lib/db/repositories/ingestion-logs";
import { SOURCE_TYPES } from "@/lib/types/db";
import { prisma } from "@/lib/db/client";
import type { Source } from "@prisma/client";
import { validateSourceUrlFields } from "@/lib/ingestion/source-url-validation";

function health(source: Source): "live" | "error" | "disabled" {
  if (!source.enabled) return "disabled";
  if (source.lastError) return "error";
  return "live";
}

// Source Health (spec §2): last successful/attempted/next-scheduled fetch
// come straight off the Source row; items-received/new-items/errors
// "today" need aggregation (raw items for the first, IngestionLog for the
// other two — see lib/db/repositories/ingestion-logs.ts for why a plain
// items-today count can't answer "errors today" or distinguish
// already-known items re-served by a feed from genuinely new ones).
//
// Bounded query count regardless of source count: one groupBy for today's raw-item counts and one
// (already-grouped, see getDailyIngestionStatsBySource) query for today's log stats — never one query
// per source. The previous per-source count() loop (one round trip per source, all fired concurrently)
// was fine against a local SQLite file but became a real outage against a real Postgres pooler with 122
// sources: this page also refetches every 15s, so it was launching 122 concurrent queries that often that
// the pooler connection budget, exhausting it and failing the whole request — the client then showed the
// empty "No sources yet" state instead of an error, because the queryFn had no error handling at all.
export async function GET() {
  try {
    const sources = await listSources();
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const [itemCountRows, dailyStats] = await Promise.all([
      prisma.rawIngestionItem.groupBy({ by: ["sourceId"], where: { receivedAt: { gte: startOfToday } }, _count: { _all: true } }),
      getDailyIngestionStatsBySource(startOfToday),
    ]);
    const itemCountsBySource = new Map(itemCountRows.map((r) => [r.sourceId, r._count._all]));

    const withHealth = sources.map((source) => ({
      ...source,
      itemsToday: itemCountsBySource.get(source.id) ?? 0,
      newItemsToday: dailyStats.get(source.id)?.newItemsToday ?? 0,
      errorsToday: dailyStats.get(source.id)?.errorsToday ?? 0,
      health: health(source),
    }));
    return NextResponse.json(withHealth);
  } catch (err) {
    console.error("[admin/sources] GET failed:", err);
    return NextResponse.json({ error: "Failed to load sources." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const body = (await request.json()) as Partial<SourceInput>;
  if (!body.name || !body.type) {
    return NextResponse.json({ error: "name and type are required" }, { status: 400 });
  }
  if (!SOURCE_TYPES.includes(body.type)) {
    return NextResponse.json({ error: `type must be one of ${SOURCE_TYPES.join(", ")}` }, { status: 400 });
  }
  const urlError = validateSourceUrlFields(body);
  if (urlError) return NextResponse.json({ error: urlError }, { status: 400 });
  const source = await createSource(body as SourceInput);
  return NextResponse.json(source, { status: 201 });
}
