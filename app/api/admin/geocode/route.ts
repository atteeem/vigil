import { NextResponse } from "next/server";
import { getGeocodingProvider } from "@/lib/geocoding/provider";

// Never silently resolves — always returns every candidate for the human
// to choose from (spec §4). GET so it's trivially cacheable/shareable and
// matches the "search place" action in the review UI.
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q")?.trim();
  if (!q) return NextResponse.json({ error: "q is required" }, { status: 400 });

  try {
    const candidates = await getGeocodingProvider().search(q);
    return NextResponse.json(candidates);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Geocoding failed" },
      { status: 502 },
    );
  }
}
