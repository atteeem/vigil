import { NextResponse } from "next/server";
import { simulate, type SimulationInput } from "@/lib/alerts/hooks";

// "If this happened, which watches would match?" Read-only: nothing is written, no notifications are created.
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as SimulationInput | null;
  if (!body?.kind) return NextResponse.json({ error: "kind is required (event, global_event, territorial_change, claim, conflict, synthetic_global)" }, { status: 400 });
  return NextResponse.json(await simulate(body));
}
