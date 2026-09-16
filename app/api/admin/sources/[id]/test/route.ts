import { NextResponse } from "next/server";
import { getSource, recordIngestionSuccess, recordIngestionError } from "@/lib/db/repositories/sources";
import { getAdapter } from "@/lib/ingestion/registry";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const source = await getSource(id);
  if (!source) return NextResponse.json({ error: "Source not found" }, { status: 404 });

  const adapter = getAdapter(source.type);
  const result = await adapter.healthCheck(source);
  if (result.ok) await recordIngestionSuccess(id);
  else await recordIngestionError(id, result.message ?? "Health check failed");

  return NextResponse.json(result);
}
