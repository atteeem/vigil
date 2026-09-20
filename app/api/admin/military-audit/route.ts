import { NextResponse } from "next/server";
import { auditEntities } from "@/lib/military/audit";

// Admin intelligence audit: entities with filters (type, conflict, country, source, alias/name text,
// and flags: stale relationships, missing provenance, unresolved aliases, untyped).
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const p = new URL(request.url).searchParams;
  const result = await auditEntities({
    entityType: p.get("entityType") ?? undefined,
    conflictId: p.get("conflictId") ?? undefined,
    country: p.get("country") ?? undefined,
    source: p.get("source") ?? undefined,
    q: p.get("q") ?? undefined,
    flag: p.get("flag") ?? undefined,
  });
  return NextResponse.json(result);
}
