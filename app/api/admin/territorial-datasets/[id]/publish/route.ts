import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { publishTerritory } from "@/lib/db/repositories/territorial-control";
import { repositoryErrorResponse } from "@/lib/territory/api-errors";

// Human approval of an imported dataset: publishes its draft territory through the SAME publishTerritory the
// per-area admin action uses (geometry re-validated, versions immutable afterwards) and marks the dataset approved.
// Nothing imports straight to published; this is the deliberate review step.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const dataset = await prisma.territorialDataset.findUnique({ where: { id } });
  if (!dataset) return NextResponse.json({ error: "Dataset not found" }, { status: 404 });
  const drafts = await prisma.conflictTerritory.findMany({ where: { datasetId: id, published: false }, select: { id: true } });
  try {
    for (const d of drafts) await publishTerritory(d.id);
  } catch (err) {
    return repositoryErrorResponse(err);
  }
  await prisma.territorialDataset.update({ where: { id }, data: { reviewStatus: "approved", geometryAvailability: "published" } });
  return NextResponse.json({ published: drafts.length });
}
