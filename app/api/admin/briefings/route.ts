import { NextResponse } from "next/server";
import { briefStats, getUniverse, parseRange } from "@/lib/brief/brief";
import { briefError } from "@/lib/brief/request";

// Briefing inspector: the whole world-wide universe for a window — every development with its
// significance and confidence reasoning, what was excluded and why, the escalation assessments with
// their signals, and the hotspot calculations.
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const p = new URL(request.url).searchParams;
  try {
    const range = parseRange({ window: p.get("window"), from: p.get("from"), to: p.get("to"), asOf: p.get("asOf") });
    const { universe, revision, cached, computeMs } = await getUniverse(range, { fresh: p.get("fresh") === "1" });
    return NextResponse.json({ range: universe.range, revision, cached, computeMs, stats: briefStats, developments: universe.developments, excluded: universe.excluded, escalation: universe.escalation, hotspots: universe.hotspots, hiddenPartyClaims: universe.developments.filter((d) => d.isPartyClaim).length });
  } catch (err) {
    return briefError(err);
  }
}
