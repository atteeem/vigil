import { NextResponse } from "next/server";
import { listCommanders, findOrCreateCommander, type CommanderInput } from "@/lib/db/repositories/military";

export async function GET() {
  const commanders = await listCommanders();
  return NextResponse.json(commanders);
}

export async function POST(request: Request) {
  const body = (await request.json()) as Partial<CommanderInput>;
  if (!body.name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  const commander = await findOrCreateCommander(body as CommanderInput);
  return NextResponse.json(commander, { status: 201 });
}
