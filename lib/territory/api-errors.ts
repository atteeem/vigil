import { NextResponse } from "next/server";
import { TerritoryValidationError } from "@/lib/db/repositories/territorial-control";
import { validateTerritorialGeometry } from "@/lib/territory/geometry";

/** 400 with one clear message per geometry problem, or null when the geometry is valid. */
export function geometryErrorResponse(geometry: unknown): NextResponse | null {
  const result = validateTerritorialGeometry(geometry);
  if (result.valid) return null;
  return NextResponse.json({ error: result.errors.join(" "), errors: result.errors }, { status: 400 });
}

/** Maps a repository error to a response: validation -> 400 with the list, "not found" -> 404, else `fallback` status. */
export function repositoryErrorResponse(err: unknown, fallbackStatus = 400): NextResponse {
  if (err instanceof TerritoryValidationError) {
    return NextResponse.json({ error: err.message, errors: err.errors }, { status: 400 });
  }
  const message = err instanceof Error ? err.message : String(err);
  return NextResponse.json({ error: message }, { status: message.includes("not found") ? 404 : fallbackStatus });
}
