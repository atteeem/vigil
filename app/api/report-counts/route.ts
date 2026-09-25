import { NextResponse } from "next/server";
import { conflictReportCounts, COUNT_WINDOWS, type CountWindow } from "@/lib/public/report-counts";

// Canonical unique-published-report counts per conflict for the displayed state (lib/public/report-counts.ts).
//   ?window=1H|6H|24H|7D|30D|45D  (default 24H)   &at=<ISO> (timeline asOf; omitted = live)
//   &type=<eventType>  &region=<region>
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const p = new URL(request.url).searchParams;
  const window = (p.get("window") ?? "24H") as CountWindow;
  if (!COUNT_WINDOWS.includes(window)) return NextResponse.json({ error: `window must be one of ${COUNT_WINDOWS.join(", ")}` }, { status: 400 });
  const at = p.get("at");
  const asOf = at ? new Date(at) : null;
  if (asOf && Number.isNaN(asOf.getTime())) return NextResponse.json({ error: "'at' is not a valid timestamp" }, { status: 400 });
  return NextResponse.json(await conflictReportCounts({ window, asOf, eventType: p.get("type"), region: p.get("region") }));
}
