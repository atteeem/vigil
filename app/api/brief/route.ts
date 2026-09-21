import { NextResponse } from "next/server";
import { getBrief } from "@/lib/brief/brief";
import { briefError, briefQueryFrom } from "@/lib/brief/request";

// Global / country / conflict / watchlist brief as structured data. Read-only over existing state.
//   GET /api/brief?window=6h|1h|12h|24h|3d|7d|custom&from&to&asOf&country=FI&conflict=<slug>&watchlist=true&claims=1
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const q = await briefQueryFrom(request);
  if (q instanceof NextResponse) return q;
  try {
    return NextResponse.json(await getBrief(q));
  } catch (err) {
    return briefError(err);
  }
}
