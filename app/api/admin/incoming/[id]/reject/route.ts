import { NextResponse } from "next/server";
import { setProcessingStatus } from "@/lib/db/repositories/raw-ingestion-items";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const item = await setProcessingStatus(id, "rejected");
  return NextResponse.json(item);
}
