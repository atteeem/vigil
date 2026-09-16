import { NextResponse } from "next/server";
import { getRssFixture } from "@/lib/testing/rss-fixtures";

// Serves static RSS XML for the Playwright suite's RSSAdapter (spec §7)
// — a real same-origin HTTP fetch, exercising the actual RSSAdapter code
// path, but with content that never changes, so the core suite doesn't
// depend on the live BBC feed. Not registered as an admin-facing feature;
// tests point a throwaway Source.url directly at this route.
//
// ?delayMs=N artificially slows the response — used by
// tests/multi-source-ingestion.spec.ts to exercise the scheduler's
// overlap-prevention path (two ticks firing while one source is still
// mid-fetch), which otherwise can't be reproduced deterministically
// against a near-instant fixture response.
export async function GET(request: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const xml = getRssFixture(name);
  if (!xml) return NextResponse.json({ error: `Unknown fixture: ${name}` }, { status: 404 });

  const delayMs = Number(new URL(request.url).searchParams.get("delayMs")) || 0;
  if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));

  return new NextResponse(xml, { headers: { "Content-Type": "application/rss+xml" } });
}
