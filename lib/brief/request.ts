import { NextResponse } from "next/server";
import { getWatcher } from "@/lib/alerts/watcher";
import { BriefInputError, type BriefQuery } from "./brief";

/** Query -> BriefQuery. `watchlist=true` (and personal scopes) need the device's x-vigil-client header. */
export async function briefQueryFrom(request: Request): Promise<BriefQuery | NextResponse> {
  const p = new URL(request.url).searchParams;
  const q: BriefQuery = { window: p.get("window"), from: p.get("from"), to: p.get("to"), asOf: p.get("asOf"), country: p.get("country"), conflict: p.get("conflict"), includePartyClaims: p.get("claims") === "1" || p.get("claims") === "true" };
  if (p.get("watchlist") === "true" || p.get("watchlist") === "1") {
    const watcher = await getWatcher(request);
    if (!watcher) return NextResponse.json({ error: "A watchlist brief needs the x-vigil-client header of the device whose watchlist it summarises" }, { status: 401 });
    q.watcherId = watcher.id;
    q.includeWatchlistWithCountry = !!q.country;
  }
  return q;
}

export const briefError = (err: unknown) => (err instanceof BriefInputError ? NextResponse.json({ error: err.message }, { status: 400 }) : Promise.reject(err));
