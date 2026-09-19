import { NextResponse } from "next/server";
import {
  updateMilitaryUnit,
  deleteMilitaryUnit,
  listUnitEquipmentLinks,
  linkUnitEquipment,
  type MilitaryUnitInput,
} from "@/lib/db/repositories/military";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await request.json()) as Partial<MilitaryUnitInput>;
  const unit = await updateMilitaryUnit(id, body);
  return NextResponse.json(unit);
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await deleteMilitaryUnit(id);
  return NextResponse.json({ ok: true });
}

// unit -> equipment relationships (spec "relationships... render
// correctly") — nested under the unit resource since a link only makes
// sense in the context of one specific unit.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const links = await listUnitEquipmentLinks(id);
  return NextResponse.json(links);
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await request.json()) as { equipmentId?: string; sourceName?: string; sourceUrl?: string };
  if (!body.equipmentId) {
    return NextResponse.json({ error: "equipmentId is required" }, { status: 400 });
  }
  const link = await linkUnitEquipment(id, body.equipmentId, body);
  return NextResponse.json(link, { status: 201 });
}
