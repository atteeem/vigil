import { NextResponse } from "next/server";
import { updateCommander, deleteCommander, listCommanderAppointments, type CommanderInput } from "@/lib/db/repositories/military";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await request.json()) as Partial<CommanderInput>;
  const commander = await updateCommander(id, body);
  return NextResponse.json(commander);
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await deleteCommander(id);
  return NextResponse.json({ ok: true });
}

// Appointment history (spec "appointment/history where sourced").
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const appointments = await listCommanderAppointments(id);
  return NextResponse.json(appointments);
}
