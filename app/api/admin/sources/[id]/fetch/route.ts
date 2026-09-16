import { NextResponse } from "next/server";
import { getSource } from "@/lib/db/repositories/sources";
import { pollSource } from "@/lib/ingestion/poll";

// "Fetch Now" — an explicit, on-demand single-source ingestion pass,
// independent of the source's auto-ingest flag/the background poller's
// interval. Never publishes anything; only writes raw_ingestion_items
// (deduplicated on source+externalId).
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const source = await getSource(id);
  if (!source) return NextResponse.json({ error: "Source not found" }, { status: 404 });

  const result = await pollSource(source);
  return NextResponse.json(result);
}
