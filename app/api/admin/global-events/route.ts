import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";

// Inspect stored structured events, including the raw provider metadata (admin only).
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const p = new URL(request.url).searchParams;
  const rows = await prisma.globalEvent.findMany({
    where: { ...(p.get("provider") ? { provider: p.get("provider")! } : {}), ...(p.get("layer") ? { layer: p.get("layer")! } : {}), ...(p.get("category") ? { category: p.get("category")! } : {}) },
    orderBy: { lastSeenAt: "desc" },
    take: Math.min(Number(p.get("limit")) || 50, 200),
    select: { id: true, provider: true, providerEventId: true, category: true, layer: true, status: true, entityKey: true, countryCode: true, title: true, prominence: true, revision: true, observedAt: true, providerUpdatedAt: true, expiresAt: true, endedAt: true, sourceUrl: true, metadata: true, lastSeenAt: true },
  });
  return NextResponse.json(rows.map((r) => ({ ...r, metadata: r.metadata ? JSON.parse(r.metadata) : null })));
}
