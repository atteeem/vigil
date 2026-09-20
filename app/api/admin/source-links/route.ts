import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";

// Marks an ingestion source as covering specific conflicts. A source may cover
// ONE conflict ({ conflictId }), SEVERAL ({ conflictSlugs }), or a region — every
// member of a conflict family ({ familySlug }). Nothing else counts: a global
// feed that occasionally mentions a conflict is not linked here and is not coverage
// for it (see COVERAGE_THRESHOLDS.minContributedEvents). Country match and
// sustained contribution are derived at read time and need no row.
interface LinkBody {
  sourceId?: string;
  conflictId?: string;
  conflictSlugs?: string[];
  familySlug?: string;
  scope?: string;
  note?: string;
}

async function resolveConflictIds(body: LinkBody): Promise<string[]> {
  const ids = new Set<string>();
  if (body.conflictId) ids.add(body.conflictId);
  if (body.conflictSlugs?.length) {
    for (const c of await prisma.conflict.findMany({ where: { slug: { in: body.conflictSlugs } }, select: { id: true } })) ids.add(c.id);
  }
  if (body.familySlug) {
    for (const c of await prisma.conflict.findMany({ where: { family: { slug: body.familySlug } }, select: { id: true } })) ids.add(c.id);
  }
  return [...ids];
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as LinkBody | null;
  if (!body?.sourceId || !(body.conflictId || body.conflictSlugs?.length || body.familySlug)) {
    return NextResponse.json({ error: "sourceId and a conflictId, conflictSlugs or familySlug are required" }, { status: 400 });
  }
  const scope = body.scope === "general" ? "general" : "dedicated";
  const source = await prisma.source.findUnique({ where: { id: body.sourceId } });
  const conflictIds = await resolveConflictIds(body);
  if (!source || conflictIds.length === 0) return NextResponse.json({ error: "Source or conflict not found" }, { status: 404 });
  const links = [];
  for (const conflictId of conflictIds) {
    links.push(
      await prisma.sourceConflictLink.upsert({
        where: { sourceId_conflictId: { sourceId: body.sourceId, conflictId } },
        update: { scope, note: body.note ?? null },
        create: { sourceId: body.sourceId, conflictId, scope, note: body.note ?? null },
      }),
    );
  }
  // A single-conflict request keeps the original response shape.
  return NextResponse.json(links.length === 1 && body.conflictId ? links[0] : { linked: links.length, links }, { status: 201 });
}

export async function DELETE(request: Request) {
  const body = (await request.json().catch(() => null)) as LinkBody | null;
  if (!body?.sourceId || !(body.conflictId || body.conflictSlugs?.length || body.familySlug)) {
    return NextResponse.json({ error: "sourceId and a conflictId, conflictSlugs or familySlug are required" }, { status: 400 });
  }
  const conflictIds = await resolveConflictIds(body);
  await prisma.sourceConflictLink.deleteMany({ where: { sourceId: body.sourceId, conflictId: { in: conflictIds } } });
  return NextResponse.json({ ok: true, removed: conflictIds.length });
}
