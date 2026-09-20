import { NextResponse } from "next/server";
import { searchPublic } from "@/lib/public/search";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q") ?? "";
  return NextResponse.json(await searchPublic(q));
}
