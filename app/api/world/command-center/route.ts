import { NextResponse } from "next/server";
import { getCommandCenter } from "@/lib/world/command-center";

// The single aggregated read behind /world: status counters, ticker, Pulse, What changed, Top entities,
// Global signals and the active-conflict markers. Party claims are included (and badged) only when the caller
// passes claims=1, which the client does only when the user's existing Profile setting is on.
//
// Global Timeline / Historical Playback (Pre-Launch Critical Correctness & Security v1 §6): an optional
// `at` query param reconstructs the brief-derived sections (whatChanged/pulse/topEntities/globalSignals)
// as of that moment — see lib/world/command-center.ts's own comment for which sections are NOT
// reconstructable (status, conflicts) and stay current/live regardless of `at`.
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const claims = params.get("claims");
  const at = params.get("at");
  let asOf: Date | null = null;
  if (at) {
    asOf = new Date(at);
    if (Number.isNaN(asOf.getTime())) return NextResponse.json({ error: "'at' is not a valid timestamp" }, { status: 400 });
  }
  return NextResponse.json(await getCommandCenter({ includePartyClaims: claims === "1" || claims === "true", asOf }));
}
