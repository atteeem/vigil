import { NextResponse } from "next/server";
import { listAvailableDatasets } from "@/lib/territory/datasets";

// What territorial datasets exist for the map: metadata only, no geometry (geometry is fetched from
// /api/territorial-control?datasets=... when a dataset is turned on). Only datasets with PUBLISHED geometry appear.
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ datasets: await listAvailableDatasets() });
}
