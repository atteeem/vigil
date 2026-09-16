import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";

// EDIT: lets an admin correct the raw item's own text/title before
// publishing — does not touch processingStatus or create an event.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await request.json()) as { originalTitle?: string; originalText?: string; originalUrl?: string };
  const item = await prisma.rawIngestionItem.update({ where: { id }, data: body });
  return NextResponse.json(item);
}
