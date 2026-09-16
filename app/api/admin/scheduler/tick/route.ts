import { NextResponse } from "next/server";
import { schedulerTick } from "@/lib/ingestion/scheduler";

interface TickBody {
  /** Test-only scoping (see lib/ingestion/scheduler.ts's schedulerTick
   * doc) — omitted (or an empty body) for the real "Run scheduler now"
   * admin action, which considers every due source. */
  sourceIds?: string[];
}

// Manually runs one scheduler pass immediately, instead of waiting for the
// background tick — used by the /admin/sources "Run scheduler now" debug
// action and by tests/multi-source-ingestion.spec.ts to exercise due/
// not-due/overlap logic deterministically via HTTP (Playwright has no
// direct access to the server process's in-memory scheduler state).
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as TickBody;
  const result = await schedulerTick(new Date(), body.sourceIds);
  return NextResponse.json(result);
}
