import { NextResponse } from "next/server";
import { listSources, createSource, type SourceInput } from "@/lib/db/repositories/sources";
import { getDailyIngestionStatsBySource } from "@/lib/db/repositories/ingestion-logs";
import { SOURCE_TYPES } from "@/lib/types/db";
import { prisma } from "@/lib/db/client";
import type { Source } from "@prisma/client";

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
export async function GET() {
  const sources = await listSources();
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const [itemCounts, dailyStats] = await Promise.all([
    Promise.all(
      sources.map((source) =>
        prisma.rawIngestionItem.count({ where: { sourceId: source.id, receivedAt: { gte: startOfToday } } }),
      ),
    ),
    getDailyIngestionStatsBySource(startOfToday),
  ]);

  const withHealth = sources.map((source, i) => ({
    ...source,
    itemsToday: itemCounts[i],
    newItemsToday: dailyStats.get(source.id)?.newItemsToday ?? 0,
    errorsToday: dailyStats.get(source.id)?.errorsToday ?? 0,
    health: health(source),
  }));
  return NextResponse.json(withHealth);
}

export async function POST(request: Request) {
  const body = (await request.json()) as Partial<SourceInput>;
  if (!body.name || !body.type) {
    return NextResponse.json({ error: "name and type are required" }, { status: 400 });
  }
  if (!SOURCE_TYPES.includes(body.type)) {
    return NextResponse.json({ error: `type must be one of ${SOURCE_TYPES.join(", ")}` }, { status: 400 });
  }
  const source = await createSource(body as SourceInput);
  return NextResponse.json(source, { status: 201 });
}
