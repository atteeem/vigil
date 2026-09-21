import { NextResponse } from "next/server";
import { planBulkPublish, runBulkPublish } from "@/lib/ingestion/bulk-publish";
import { filtersFromParams } from "@/lib/ingestion/incoming-queue";
import { PublishError } from "@/lib/ingestion/publish-item";

// "Publish filtered" / "Publish selected". The body carries the queue's filters in the same query-string form as
// GET /api/admin/incoming (`filters`), an optional `ids` subset, and `mode`:
//   preview -> an exact recount and what would be published / skipped / warned about (writes nothing)
//   publish -> publishes; `expectedCount` (from the preview) guards against the filtered set changing underneath.
// Sort never changes which reports are included.
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json()) as { filters?: string; ids?: string[]; mode?: "preview" | "publish"; expectedCount?: number };
  const filters = filtersFromParams(new URLSearchParams(body.filters ?? ""));
  try {
    if (body.mode === "publish") return NextResponse.json(await runBulkPublish(filters, { ids: body.ids, expectedCount: body.expectedCount }));
    return NextResponse.json(await planBulkPublish(filters, body.ids));
  } catch (err) {
    if (err instanceof PublishError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
