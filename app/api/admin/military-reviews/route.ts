import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { resolveMatchReview } from "@/lib/military/link-entities";

// Ambiguous entity mentions held for a person to decide (nothing is linked on a guess).
export const dynamic = "force-dynamic";

export async function GET() {
  const rows = await prisma.entityMatchReview.findMany({ where: { status: "pending" }, include: { rawIngestionItem: { select: { originalTitle: true, originalUrl: true } } }, orderBy: { createdAt: "desc" }, take: 100 });
  const unitIds = rows.filter((r) => r.entityKind === "unit").flatMap((r) => JSON.parse(r.candidateIds) as string[]);
  const units = new Map((await prisma.militaryUnit.findMany({ where: { id: { in: unitIds } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  return NextResponse.json(
    rows.map((r) => ({
      id: r.id,
      entityKind: r.entityKind,
      matchedText: r.matchedText,
      reason: r.reason,
      reportTitle: r.rawIngestionItem.originalTitle,
      reportUrl: r.rawIngestionItem.originalUrl,
      candidates: (JSON.parse(r.candidateIds) as string[]).map((id) => ({ id, name: units.get(id) ?? id })),
      createdAt: r.createdAt.toISOString(),
    })),
  );
}

// { id, entityId } picks the entity (creates the link); { id, entityId: null } dismisses.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { id?: string; entityId?: string | null } | null;
  if (!body?.id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  const result = await resolveMatchReview(body.id, body.entityId ?? null);
  return NextResponse.json(result, { status: result.ok ? 200 : 409 });
}
