import { NextResponse } from "next/server";
import { updateMilitaryEquipment, deleteMilitaryEquipment, type MilitaryEquipmentInput } from "@/lib/db/repositories/military";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await request.json()) as Partial<MilitaryEquipmentInput>;
  const equipment = await updateMilitaryEquipment(id, body);
  return NextResponse.json(equipment);
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await deleteMilitaryEquipment(id);
  return NextResponse.json({ ok: true });
}
