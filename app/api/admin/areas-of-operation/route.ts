import { NextResponse } from "next/server";
import { listAreasOfOperation, createAreaOfOperation } from "@/lib/db/repositories/myanmar";
import { LOCATION_PRECISIONS, type LocationPrecision } from "@/lib/types/db";

// Areas of Operation are their own resource — never routed through
// /api/admin/territorial-control, which owns real control polygons.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const areas = await listAreasOfOperation({
    unitId: url.searchParams.get("unitId") ?? undefined,
    conflictId: url.searchParams.get("conflictId") ?? undefined,
  });
  return NextResponse.json(areas);
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    unitId?: string;
    conflictId?: string | null;
    name?: string;
    description?: string;
    geometry?: unknown;
    precision?: string;
    asOfDate?: string;
    sourceName?: string;
    sourceUrl?: string;
  } | null;
  if (!body?.unitId || !body.geometry) {
    return NextResponse.json({ error: "unitId and geometry are required" }, { status: 400 });
  }
  const precision = LOCATION_PRECISIONS.includes(body.precision as LocationPrecision)
    ? (body.precision as LocationPrecision)
    : "unknown";
  const area = await createAreaOfOperation({
    unitId: body.unitId,
    conflictId: body.conflictId,
    name: body.name,
    description: body.description,
    geometry: typeof body.geometry === "string" ? body.geometry : JSON.stringify(body.geometry),
    precision,
    asOfDate: body.asOfDate ? new Date(body.asOfDate) : null,
    sourceName: body.sourceName,
    sourceUrl: body.sourceUrl,
  });
  return NextResponse.json(area, { status: 201 });
}
