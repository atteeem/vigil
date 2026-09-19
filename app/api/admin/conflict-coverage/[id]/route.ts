import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { getCoverageRow } from "@/lib/db/repositories/coverage";

// One conflict's coverage row plus the metadata provenance, family members and
// candidate sources the dashboard detail panel shows.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = await getCoverageRow(id);
  if (!row) return NextResponse.json({ error: "Conflict not found" }, { status: 404 });
  const [provenance, candidates, siblings] = await Promise.all([
    prisma.conflictMetadataSource.findMany({ where: { conflictId: id }, orderBy: [{ field: "asc" }, { sourceName: "asc" }] }),
    prisma.sourceCandidate.findMany({ where: { conflictId: id }, orderBy: { createdAt: "asc" } }),
    row.family ? prisma.conflict.findMany({ where: { familyId: row.family.id, NOT: { id } }, select: { id: true, slug: true, name: true, status: true } }) : Promise.resolve([]),
  ]);
  return NextResponse.json({
    ...row,
    provenance: provenance.map((p) => ({ field: p.field, sourceName: p.sourceName, sourceUrl: p.sourceUrl, note: p.note, retrievedAt: p.retrievedAt?.toISOString() ?? null })),
    candidates,
    familyMembers: siblings,
  });
}
