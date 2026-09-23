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
  // Geometry is loaded ON DEMAND for the datasets the user turned on (availability metadata is a separate, cheap
  // endpoint). Without `datasets` nothing is returned: no request ever ships every territory on Earth.
  const datasetsParam = new URL(request.url).searchParams.get("datasets");
  const datasetIds = datasetsParam ? datasetsParam.split(",").map((s) => s.trim()).filter(Boolean) : [];
  if (datasetIds.length === 0) return NextResponse.json(territoriesToGeoJSON([]));
  const territories = await listTerritoriesAt(timestamp, { datasetIds });
  return NextResponse.json(territoriesToGeoJSON(territories));
}
