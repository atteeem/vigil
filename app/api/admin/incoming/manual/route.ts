import { NextResponse } from "next/server";
import { getSource } from "@/lib/db/repositories/sources";
import { createRawIngestionItemIfNew } from "@/lib/db/repositories/raw-ingestion-items";
import { ManualSourceAdapter } from "@/lib/ingestion/manual-adapter";

interface ManualSubmitBody {
  sourceId: string;
  originalTitle?: string;
  originalText?: string;
  originalUrl?: string;
}

// Entry point for a human-submitted report against a "manual" type source
// — e.g. pasting in a report seen elsewhere. Goes through the same
// normalize → dedupe → raw_ingestion_items path as any adapter, so it
// lands in /admin/incoming for review exactly like an RSS item would.
export async function POST(request: Request) {
  const body = (await request.json()) as ManualSubmitBody;
  if (!body.sourceId) return NextResponse.json({ error: "sourceId is required" }, { status: 400 });

  const source = await getSource(body.sourceId);
  if (!source) return NextResponse.json({ error: "Source not found" }, { status: 404 });

  const normalized = ManualSourceAdapter.normalize(body, source);
  const { item, created } = await createRawIngestionItemIfNew({ sourceId: source.id, ...normalized });
  return NextResponse.json(item, { status: created ? 201 : 200 });
}
