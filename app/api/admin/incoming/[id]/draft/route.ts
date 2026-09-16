import { NextResponse } from "next/server";
import { getRawIngestionItem } from "@/lib/db/repositories/raw-ingestion-items";
import { getSource } from "@/lib/db/repositories/sources";
import { extractDraft } from "@/lib/ingestion/draft";

// Computed on demand (not persisted) so it never goes stale relative to
// newly published events (duplicate candidates) or conflict data — see
// ARCHITECTURE.md "Source ingestion pipeline". Returns `{ draft: null }`
// when the source has automated processing disabled.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const item = await getRawIngestionItem(id);
  if (!item) return NextResponse.json({ error: "Raw item not found" }, { status: 404 });

  const source = await getSource(item.sourceId);
  if (!source) return NextResponse.json({ error: "Source not found" }, { status: 404 });

  const draft = await extractDraft(item, source);
  return NextResponse.json({ draft });
}
