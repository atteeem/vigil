import { NextResponse } from "next/server";
import { queryHazards } from "@/lib/hazards/query";
import { HAZARD_LAYERS, type HazardLayer } from "@/lib/hazards/types";

// Public read path for the natural-hazard layers. Same `at` convention as /api/events and
// /api/territorial-control (one global timeline, no second one). Always bounded: pass a viewport
// (`bbox=w,s,e,n`) and `zoom`; thermal detections are aggregated server-side below zoom 7.
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const p = new URL(request.url).searchParams;
  const atRaw = p.get("at");
  const at = atRaw ? new Date(atRaw) : null;
  if (at && Number.isNaN(at.getTime())) return NextResponse.json({ error: "'at' is not a valid timestamp" }, { status: 400 });

  const layers = (p.get("layers") ?? "").split(",").filter((l): l is HazardLayer => (HAZARD_LAYERS as readonly string[]).includes(l));
  const bboxRaw = p.get("bbox")?.split(",").map(Number);
  const bbox = bboxRaw && bboxRaw.length === 4 && bboxRaw.every(Number.isFinite) ? (bboxRaw as [number, number, number, number]) : null;
  const zoom = p.get("zoom") ? Number(p.get("zoom")) : null;

  // An empty layer list is a valid "nothing selected" request, not "everything".
  if (p.has("layers") && layers.length === 0) {
    const empty = await queryHazards({ layers: [], at, bbox, zoom });
    return NextResponse.json({ ...empty, features: [] });
  }
  const collection = await queryHazards({ layers, at, bbox, zoom: zoom != null && Number.isFinite(zoom) ? zoom : null });
  return NextResponse.json(collection, { headers: { "Cache-Control": at ? "public, max-age=120" : "public, max-age=15" } });
}
