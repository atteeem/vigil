import { NextResponse } from "next/server";
import { listUnitEventLinks } from "@/lib/db/repositories/military";

// actor -> events
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return NextResponse.json(await listUnitEventLinks(id));
}
