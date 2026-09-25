import { NextResponse } from "next/server";
import { getPublicFreshness } from "@/lib/public/overview";
import { liveState } from "@/lib/world/derive";

export const dynamic = "force-dynamic";

/** The global LIVE indicator: the same freshness rule as the World Command Center (newest successful ingestion across
 * enabled sources), so the header never claims LIVE when ingestion has stopped. */
export async function GET() {
  const now = new Date();
  const f = await getPublicFreshness(now);
  return NextResponse.json({ ...liveState(f.lastIngestionAt, now), lastIngestionAt: f.lastIngestionAt, lastEventAt: f.lastEventAt, enabledSources: f.enabledSources, staleSources: f.staleSources });
}
