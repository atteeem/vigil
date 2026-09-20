import { NextResponse } from "next/server";
import { searchWatchables } from "@/lib/alerts/entities";
import { WATCH_ENTITY_TYPES, type WatchEntityType } from "@/lib/alerts/types";

export const dynamic = "force-dynamic";

/** Search for things that can be followed (the picker on the Watchlist page). Public reference data only. */
export async function GET(request: Request) {
  const p = new URL(request.url).searchParams;
  const type = p.get("type") as WatchEntityType;
  if (!(WATCH_ENTITY_TYPES as readonly string[]).includes(type)) return NextResponse.json({ error: `type must be one of ${WATCH_ENTITY_TYPES.join(", ")}` }, { status: 400 });
  return NextResponse.json(await searchWatchables(type, p.get("q") ?? ""));
}
