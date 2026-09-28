import { NextResponse } from "next/server";
import { findClusterCandidatePairs, findRetroactiveMergeGroups, applyRetroactiveMergeGroup } from "@/lib/events/cluster-audit";

// Event Clustering v1 — read-only dry-run diagnostic (spec §1, §9): scores every published event against
// every other published event with the real duplicate scorer and returns candidate same-incident pairs.
// Never mutates anything. mode=retroactive uses the exact same criteria as the live auto-merge
// (lib/ingestion/event-match.ts), grouped transitively; mode=pairs (default) is the looser, exploratory
// pairwise scan used for the initial audit.
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  if (url.searchParams.get("mode") === "retroactive") {
    const groups = await findRetroactiveMergeGroups();
    return NextResponse.json({ groupCount: groups.length, groups });
  }
  const minScore = Number(url.searchParams.get("minScore") ?? "50");
  const pairs = await findClusterCandidatePairs(minScore);
  return NextResponse.json({ minScore, pairCount: pairs.length, pairs });
}

// Applies specific, already-reviewed retroactive-merge groups (spec §11) — never "apply everything";
// the caller must name each canonical event id it has actually reviewed.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { canonicalEventIds?: string[] };
  if (!body.canonicalEventIds?.length) return NextResponse.json({ error: "canonicalEventIds is required" }, { status: 400 });
  const groups = await findRetroactiveMergeGroups();
  const results = [];
  for (const id of body.canonicalEventIds) {
    const group = groups.find((g) => g.canonicalEventId === id);
    if (!group) continue;
    results.push(await applyRetroactiveMergeGroup(group));
  }
  return NextResponse.json({ applied: results.length, results });
}
