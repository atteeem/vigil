import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { dbEventToConflictEvent } from "@/lib/data/world-events";

// Polled by hooks/use-live-events.ts so newly published events appear on
// /world without a full page reload (Implementation Order #13 / spec §15).
export async function GET() {
  const events = await prisma.event.findMany({
    where: { published: true },
    include: { sources: { include: { rawIngestionItem: { include: { source: true } } } } },
    orderBy: { occurredAt: "desc" },
  });
  return NextResponse.json(events.map(dbEventToConflictEvent));
}
