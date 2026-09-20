import { NextResponse } from "next/server";
import { getSignificantHazards } from "@/lib/hazards/query";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await getSignificantHazards(6));
}
