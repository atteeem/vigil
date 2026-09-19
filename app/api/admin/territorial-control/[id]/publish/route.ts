import { NextResponse } from "next/server";
import { publishTerritory, getTerritory } from "@/lib/db/repositories/territorial-control";
import { repositoryErrorResponse } from "@/lib/territory/api-errors";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    await publishTerritory(id);
  } catch (err) {
    return repositoryErrorResponse(err);
  }
  return NextResponse.json(await getTerritory(id));
}
