import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import type { ProcessingStatus } from "@/lib/types/db";

export async function GET(request: Request) {
  const status = new URL(request.url).searchParams.get("status") as ProcessingStatus | null;
  const items = await prisma.rawIngestionItem.findMany({
    where: status ? { processingStatus: status } : undefined,
    include: { source: true },
    orderBy: { receivedAt: "desc" },
  });
  return NextResponse.json(
    items.map((item) => ({
      ...item,
      mediaUrls: item.mediaUrls ? JSON.parse(item.mediaUrls) : [],
      rawMetadata: item.rawMetadata ? JSON.parse(item.rawMetadata) : null,
    })),
  );
}
