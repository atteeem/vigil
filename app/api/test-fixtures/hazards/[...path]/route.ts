import { NextResponse } from "next/server";
import { getHazardFixture } from "@/lib/testing/hazard-fixtures";

// Test-only structured-provider payloads (see lib/testing/hazard-fixtures.ts). Exists only when the
// test server sets TEST_FIXTURES=true; ?v=2 serves the provider's next revision, ?status=N /
// ?retryAfter=N simulate provider failures for the health/backoff tests.
export async function GET(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  if (process.env.TEST_FIXTURES !== "true") return new NextResponse("Not found", { status: 404 });
  const { path } = await params;
  const url = new URL(request.url);
  const status = Number(url.searchParams.get("status")) || 0;
  if (status) {
    const headers: Record<string, string> = {};
    const retryAfter = url.searchParams.get("retryAfter");
    if (retryAfter) headers["Retry-After"] = retryAfter;
    return new NextResponse(`Simulated ${status} response`, { status, headers });
  }
  // ?t=<epoch ms> pins "now": a payload that shifts on every request would look like a provider revision each poll.
  const fixture = getHazardFixture(path, url.searchParams.get("v") ?? "1", Number(url.searchParams.get("t")) || Date.now());
  if (!fixture) return NextResponse.json({ error: `Unknown fixture: ${path.join("/")}` }, { status: 404 });
  return new NextResponse(fixture.body, { headers: { "Content-Type": fixture.contentType } });
}
