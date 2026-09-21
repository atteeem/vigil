import { NextResponse } from "next/server";
import { PublishError, publishRawItem, type PublishInput } from "@/lib/ingestion/publish-item";

// PUBLISH: creates a real Event from a reviewed raw_ingestion_item (see lib/ingestion/publish-item.ts, shared with
// "Publish filtered"). Never runs automatically: a person always triggers it from /admin/incoming (spec §9).
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await request.json()) as PublishInput;
  try {
    return NextResponse.json(await publishRawItem(id, body), { status: 201 });
  } catch (err) {
    if (err instanceof PublishError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
