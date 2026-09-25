import { NextResponse } from "next/server";
import { getWatcher } from "@/lib/alerts/watcher";
import { getForYouFeed } from "@/lib/discovery/for-you";

// The For You feed: developments related to what this browser follows (x-vigil-client) or its selected country
// (?country=FI), each with its reason. Works without a watcher (country only).
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const watcher = request.headers.get("x-vigil-client") ? await getWatcher(request) : null;
  const country = new URL(request.url).searchParams.get("country");
  return NextResponse.json(await getForYouFeed(watcher?.id ?? null, country));
}
