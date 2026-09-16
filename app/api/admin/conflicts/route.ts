import { NextResponse } from "next/server";
import {
  listConflictsWithEventCounts,
  listSelectableConflicts,
  createConflict,
  toConflictDTO,
  type ConflictInput,
} from "@/lib/db/repositories/conflicts";

// ?selectable=true returns only active/dormant conflicts (for the
// incoming-report review/event-editor picker — spec "Incoming-report
// review and event editor must use these DB conflicts"); otherwise
// returns every conflict with its linked-event count, for /admin/conflicts.
export async function GET(request: Request) {
  const selectable = new URL(request.url).searchParams.get("selectable") === "true";
  if (selectable) {
    const conflicts = await listSelectableConflicts();
    return NextResponse.json(conflicts.map((c) => toConflictDTO(c)));
  }
  const conflicts = await listConflictsWithEventCounts();
  return NextResponse.json(conflicts.map((c) => toConflictDTO(c)));
}

export async function POST(request: Request) {
  const body = (await request.json()) as Partial<ConflictInput>;
  if (!body.slug || !body.name || !body.region || !body.severity || body.intensity === undefined) {
    return NextResponse.json({ error: "slug, name, region, severity, and intensity are required" }, { status: 400 });
  }
  try {
    const conflict = await createConflict(body as ConflictInput);
    return NextResponse.json(toConflictDTO(conflict), { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes("Unique constraint") ? 409 : 500;
    return NextResponse.json({ error: status === 409 ? "A conflict with this slug already exists." : message }, { status });
  }
}
