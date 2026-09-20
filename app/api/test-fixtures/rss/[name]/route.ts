import { NextResponse } from "next/server";
import { getRssFixture } from "@/lib/testing/rss-fixtures";

// Serves static RSS XML for the Playwright suite's RSSAdapter (spec §7)
// — a real same-origin HTTP fetch, exercising the actual RSSAdapter code
// path, but with content that never changes, so the core suite doesn't
// depend on the live BBC feed. Not registered as an admin-facing feature;
// tests point a throwaway Source.url directly at this route.
//
// ?delayMs=N artificially slows the response — used by
// tests/multi-source-ingestion.spec.ts's overlap-prevention test and
// tests/ingestion-reliability.spec.ts's timeout test (paired with a short
// INGESTION_FETCH_TIMEOUT_MS in playwright.config.ts).
//
// ?status=N simulates an HTTP error status (spec "HTTP Failure
// Handling": 403/406/429/5xx) instead of serving the fixture feed —
// ?retryAfter=N additionally sends a Retry-After header (seconds) on
// that error response, for the Retry-After-respects-backoff test.
export async function GET(request: Request, { params }: { params: Promise<{ name: string }> }) {
  // Test-only: serves fabricated feeds, so it exists only when the test server
  // sets TEST_FIXTURES=true (playwright.config.ts). A normal server 404s.
  if (process.env.TEST_FIXTURES !== "true") return new NextResponse("Not found", { status: 404 });
  const { name } = await params;
  const url = new URL(request.url);

  const delayMs = Number(url.searchParams.get("delayMs")) || 0;
  if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));

  const status = Number(url.searchParams.get("status")) || 0;
  if (status) {
    const headers: Record<string, string> = {};
    const retryAfter = url.searchParams.get("retryAfter");
    if (retryAfter) headers["Retry-After"] = retryAfter;
    return new NextResponse(`Simulated ${status} response`, { status, headers });
  }

  const xml = getRssFixture(name);
  if (!xml) return NextResponse.json({ error: `Unknown fixture: ${name}` }, { status: 404 });

  return new NextResponse(xml, { headers: { "Content-Type": "application/rss+xml" } });
}
