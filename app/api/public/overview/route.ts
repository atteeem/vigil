import { NextResponse } from "next/server";
import { getPublicOverview } from "@/lib/public/overview";

// Bounded public payload (conflicts, recent-event window, latest approved
// territorial changes, freshness) — the one read the homepage, globe, For You
// and heat surface share.
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await getPublicOverview());
}
