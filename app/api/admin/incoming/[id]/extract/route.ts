import { NextResponse } from "next/server";
import { getRawIngestionItem } from "@/lib/db/repositories/raw-ingestion-items";
import { extractFacts } from "@/lib/ingestion/extract-facts";
import { replaceExtractedFacts, toExtractedFactDTO } from "@/lib/db/repositories/extracted-facts";

// Structured Event Intelligence: runs extraction on demand, regardless
// of the source's autoProcessing flag (unlike the ingestion-time
// automatic run in lib/ingestion/poll.ts) — an admin reviewing a report
// from a source that doesn't auto-process, or one who just edited the
// raw text, can still ask for fresh facts. Untouched ("extracted")
// facts are replaced; anything the admin already accepted/rejected/
// edited is left alone (see replaceExtractedFacts).
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const item = await getRawIngestionItem(id);
  if (!item) return NextResponse.json({ error: "Item not found" }, { status: 404 });

  const drafts = await extractFacts(item);
  const facts = await replaceExtractedFacts(id, drafts, item.publishedAt ?? item.receivedAt);
  return NextResponse.json({ facts: facts.map(toExtractedFactDTO) });
}
