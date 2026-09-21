import { NextResponse } from "next/server";
import { getCommandCenter } from "@/lib/world/command-center";

// The single aggregated read behind /world: status counters, ticker, Pulse, What changed, Top entities,
// Global signals and the active-conflict markers. Party claims are included (and badged) only when the caller
// passes claims=1, which the client does only when the user's existing Profile setting is on.
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const claims = new URL(request.url).searchParams.get("claims");
  return NextResponse.json(await getCommandCenter({ includePartyClaims: claims === "1" || claims === "true" }));
}
