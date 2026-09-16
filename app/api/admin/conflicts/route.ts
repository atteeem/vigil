import { NextResponse } from "next/server";
import { listConflicts } from "@/lib/db/repositories/conflicts";

export async function GET() {
  const conflicts = await listConflicts();
  return NextResponse.json(conflicts);
}
