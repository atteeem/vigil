import { NextResponse } from "next/server";
import { listTerritoriesAt } from "@/lib/db/repositories/territorial-control";
import { territoriesToGeoJSON } from "@/lib/map/territorial-to-geojson";

// Public territorial-control read path, mirroring app/api/events/route.ts's
// own `at` convention exactly (spec §5 "respect the existing global asOf
// timestamp... do not create a second timeline system") — `at` omitted
// means "now" (Live), `at` present reconstructs the state valid at that
// instant. Only ever returns published versions.
export async function GET(request: Request) {
  const at = new URL(request.url).searchParams.get("at");
  const timestamp = at ? new Date(at) : new Date();
  if (at && Number.isNaN(timestamp.getTime())) {
    return NextResponse.json({ error: "'at' is not a valid timestamp" }, { status: 400 });
  }
  const territories = await listTerritoriesAt(timestamp);
  return NextResponse.json(territoriesToGeoJSON(territories));
}
