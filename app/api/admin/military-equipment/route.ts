import { NextResponse } from "next/server";
import {
  listMilitaryEquipment,
  findOrCreateMilitaryEquipment,
  type MilitaryEquipmentInput,
} from "@/lib/db/repositories/military";

export async function GET() {
  const equipment = await listMilitaryEquipment();
  return NextResponse.json(equipment);
}

export async function POST(request: Request) {
  const body = (await request.json()) as Partial<MilitaryEquipmentInput>;
  if (!body.name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  const equipment = await findOrCreateMilitaryEquipment(body as MilitaryEquipmentInput);
  return NextResponse.json(equipment, { status: 201 });
}
