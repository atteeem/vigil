import { NextResponse } from "next/server";
import { getRssFixture } from "@/lib/testing/rss-fixtures";

// Serves static RSS XML for the Playwright suite's RSSAdapter (spec §7)
// — a real same-origin HTTP fetch, exercising the actual RSSAdapter code
// path, but with content that never changes, so the core suite doesn't
// depend on the live BBC feed. Not registered as an admin-facing feature;
// tests point a throwaway Source.url directly at this route.
export async function GET(_request: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const xml = getRssFixture(name);
  if (!xml) return NextResponse.json({ error: `Unknown fixture: ${name}` }, { status: 404 });
  return new NextResponse(xml, { headers: { "Content-Type": "application/rss+xml" } });
}
