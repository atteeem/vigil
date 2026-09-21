import { NextResponse } from "next/server";
import { getConflictContext } from "@/lib/world/conflict-context";

// Selected-conflict context for the /world right rail (fetched on selection only, never polled).
//   GET /api/world/conflict?slug=<slug>&country=<ISO code>
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const p = new URL(request.url).searchParams;
  const slug = p.get("slug");
  if (!slug) return NextResponse.json({ error: "slug is required" }, { status: 400 });
  const ctx = await getConflictContext(slug, p.get("country"));
  if (!ctx) return NextResponse.json({ error: "Unknown conflict" }, { status: 404 });
  return NextResponse.json(ctx);
}
