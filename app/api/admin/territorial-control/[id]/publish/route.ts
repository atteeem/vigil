import { NextResponse } from "next/server";
import { publishTerritory, getTerritory } from "@/lib/db/repositories/territorial-control";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    await publishTerritory(id);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: message.includes("not found") ? 404 : 400 });
  }
  return NextResponse.json(await getTerritory(id));
}
