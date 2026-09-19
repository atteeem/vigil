import { NextResponse } from "next/server";
import { listMilitaryUnits, findOrCreateMilitaryUnit, type MilitaryUnitInput } from "@/lib/db/repositories/military";

export async function GET() {
  const units = await listMilitaryUnits();
  return NextResponse.json(units);
}

export async function POST(request: Request) {
  const body = (await request.json()) as Partial<MilitaryUnitInput>;
  if (!body.name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  const unit = await findOrCreateMilitaryUnit(body as MilitaryUnitInput);
  return NextResponse.json(unit, { status: 201 });
}
