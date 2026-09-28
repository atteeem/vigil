import { NextResponse } from "next/server";
import { updateSource, deleteSource, type SourceInput } from "@/lib/db/repositories/sources";
import { validateSourceUrlFields } from "@/lib/ingestion/source-url-validation";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await request.json()) as Partial<SourceInput>;
  const urlError = validateSourceUrlFields(body);
  if (urlError) return NextResponse.json({ error: urlError }, { status: 400 });
  const source = await updateSource(id, body);
  return NextResponse.json(source);
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await deleteSource(id);
  return NextResponse.json({ ok: true });
}
