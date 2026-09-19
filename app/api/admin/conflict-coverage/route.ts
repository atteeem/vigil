import { NextResponse } from "next/server";
import { listCoverage, type CoverageFilter } from "@/lib/db/repositories/coverage";

// Admin coverage tool (never public): per-conflict source coverage and
// freshness. Filters: region, status, severity, health, dedicated=true|false,
// territorial=true|false, family. The summary always covers the whole registry.
export async function GET(request: Request) {
  const p = new URL(request.url).searchParams;
  const bool = (name: string) => (p.get(name) === "true" ? true : p.get(name) === "false" ? false : undefined);
  const filter: CoverageFilter = {
    region: p.get("region") || undefined,
    status: p.get("status") || undefined,
    severity: p.get("severity") || undefined,
    health: p.get("health") || undefined,
    dedicated: bool("dedicated"),
    territorial: bool("territorial"),
    familySlug: p.get("family") || undefined,
  };
  return NextResponse.json(await listCoverage(filter));
}
