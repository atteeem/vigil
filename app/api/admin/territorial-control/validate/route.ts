import { NextResponse } from "next/server";
import { validateTerritorialGeometry } from "@/lib/territory/geometry";

// Read-only geometry validation for the editor's Preview step.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { geometry?: unknown } | null;
  return NextResponse.json(validateTerritorialGeometry(body?.geometry));
}
