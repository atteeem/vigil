import { NextResponse } from "next/server";
import { listSources, createSource, type SourceInput } from "@/lib/db/repositories/sources";
import { SOURCE_TYPES } from "@/lib/types/db";

export async function GET() {
  const sources = await listSources();
  return NextResponse.json(sources);
}

export async function POST(request: Request) {
  const body = (await request.json()) as Partial<SourceInput>;
  if (!body.name || !body.type) {
    return NextResponse.json({ error: "name and type are required" }, { status: 400 });
  }
  if (!SOURCE_TYPES.includes(body.type)) {
    return NextResponse.json({ error: `type must be one of ${SOURCE_TYPES.join(", ")}` }, { status: 400 });
  }
  const source = await createSource(body as SourceInput);
  return NextResponse.json(source, { status: 201 });
}
