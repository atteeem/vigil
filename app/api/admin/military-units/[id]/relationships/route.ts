import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { addEntityAlias } from "@/lib/military/aliases";
import { addActorRelationship, appointCommander, linkParticipant, setUnitParent } from "@/lib/military/knowledge";
import { ALIAS_TYPES, RELATION_TYPES, isEntityType, type AliasType, type RelationType } from "@/lib/military/entity-types";

// Inspect and correct one entity's relationships. Every change keeps history and provenance;
// there is deliberately no bulk graph editing here.
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const unit = await prisma.militaryUnit.findUnique({ where: { id } });
  if (!unit) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const [aliases, parentHistory, appointments, equipment, participants, relationships] = await Promise.all([
    prisma.entityAlias.findMany({ where: { entityKind: "unit", entityId: id }, orderBy: { createdAt: "asc" } }),
    prisma.unitParentHistory.findMany({ where: { unitId: id }, include: { parent: { select: { name: true } } }, orderBy: { createdAt: "desc" } }),
    prisma.commanderAppointment.findMany({ where: { unitId: id }, include: { commander: { select: { name: true } } }, orderBy: { createdAt: "desc" } }),
    prisma.militaryUnitEquipment.findMany({ where: { unitId: id }, include: { equipment: { select: { name: true } } } }),
    prisma.conflictParticipant.findMany({ where: { unitId: id }, include: { conflict: { select: { name: true } } } }),
    prisma.actorRelationship.findMany({ where: { OR: [{ fromId: id }, { toId: id }] }, include: { from: { select: { name: true } }, to: { select: { name: true } } } }),
  ]);
  return NextResponse.json({ unit, aliases, parentHistory, appointments, equipment, participants, relationships });
}

interface Body {
  action?: string;
  parentId?: string | null;
  alias?: string;
  aliasType?: string;
  countryScope?: string | null;
  sourceScope?: string | null;
  otherId?: string;
  relationType?: string;
  conflictId?: string | null;
  commanderId?: string;
  role?: string;
  entityType?: string | null;
  country?: string | null;
  sourceName?: string | null;
  sourceUrl?: string | null;
  confidence?: number | null;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as Body | null;
  if (!body?.action) return NextResponse.json({ error: "action is required" }, { status: 400 });
  if (!(await prisma.militaryUnit.findUnique({ where: { id }, select: { id: true } }))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const prov = { sourceName: body.sourceName ?? null, sourceUrl: body.sourceUrl ?? null, confidence: body.confidence ?? null };
  try {
    switch (body.action) {
      case "set_parent":
        return NextResponse.json(await setUnitParent(id, body.parentId ?? null, prov));
      case "add_alias": {
        if (!body.alias) return NextResponse.json({ error: "alias is required" }, { status: 400 });
        const type = (ALIAS_TYPES as readonly string[]).includes(body.aliasType ?? "") ? (body.aliasType as AliasType) : "alternate";
        const r = await addEntityAlias("unit", id, body.alias, { aliasType: type, countryScope: body.countryScope, sourceScope: body.sourceScope, sourceName: prov.sourceName, sourceUrl: prov.sourceUrl });
        return NextResponse.json(r, { status: r.ok ? 200 : 409 });
      }
      case "add_relationship": {
        if (!body.otherId || !(RELATION_TYPES as readonly string[]).includes(body.relationType ?? "")) return NextResponse.json({ error: "otherId and a valid relationType are required" }, { status: 400 });
        if (!prov.sourceName && !prov.sourceUrl) return NextResponse.json({ error: "A relationship needs a source (name or URL): alliances are never inferred." }, { status: 400 });
        return NextResponse.json(await addActorRelationship(id, body.otherId, body.relationType as RelationType, { ...prov, conflictId: body.conflictId }));
      }
      case "appoint_commander": {
        if (!body.commanderId) return NextResponse.json({ error: "commanderId is required" }, { status: 400 });
        return NextResponse.json(await appointCommander(body.commanderId, id, { ...prov, role: body.role ?? "commander" }));
      }
      case "link_conflict": {
        if (!body.conflictId) return NextResponse.json({ error: "conflictId is required" }, { status: 400 });
        const role = (["belligerent", "participant", "supporter"] as const).find((r) => r === body.role) ?? "belligerent";
        await linkParticipant(body.conflictId, id, role, prov);
        return NextResponse.json({ ok: true });
      }
      case "set_type": {
        if (body.entityType !== null && body.entityType !== undefined && !isEntityType(body.entityType)) return NextResponse.json({ error: "Unknown entityType" }, { status: 400 });
        const updated = await prisma.militaryUnit.update({ where: { id }, data: { entityType: body.entityType ?? null, ...(body.country !== undefined ? { country: body.country } : {}), lastUpdatedAt: new Date() } });
        return NextResponse.json(updated);
      }
      default:
        return NextResponse.json({ error: `Unknown action ${body.action}` }, { status: 400 });
    }
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 409 });
  }
}
