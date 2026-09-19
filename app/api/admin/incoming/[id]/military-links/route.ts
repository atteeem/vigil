import { NextResponse } from "next/server";
import { getArticleMilitaryLinks } from "@/lib/db/repositories/military";

// article/report -> referenced unit/equipment/commander (spec) — lets the
// admin/reference UI show which entities a given incoming report was
// auto-linked to.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const links = await getArticleMilitaryLinks(id);
  return NextResponse.json(links);
}
