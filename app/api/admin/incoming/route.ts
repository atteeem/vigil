import { NextResponse } from "next/server";
import { filtersFromParams, listIncomingItems } from "@/lib/ingestion/incoming-queue";

// Incoming Queue (spec §8: filters + sorting): see lib/ingestion/incoming-queue.ts. The same function feeds
// "Publish filtered", so what is published is exactly what is listed.
export async function GET(request: Request) {
  return NextResponse.json(await listIncomingItems(filtersFromParams(new URL(request.url).searchParams)));
}
