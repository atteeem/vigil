import { prisma } from "@/lib/db/client";
import { textMatchTable } from "@/lib/actors/registry";
import { extractCommanderMentions, extractEquipmentMentions, extractUnitMentions } from "@/lib/military/extract-entities";
import { normalizeEntityText, resolveEntity, type EntityKind } from "@/lib/military/aliases";
import { findOrCreateCommander, findOrCreateMilitaryEquipment, findOrCreateMilitaryUnit, linkArticleToCommander, linkArticleToEquipment, linkArticleToUnit, linkUnitToEvent } from "@/lib/db/repositories/military";

// Deterministic entity extraction for a report: which known actors, units, commanders and
// equipment does it name? Every link records HOW it was found (method), the exact text that
// matched, and a confidence. Resolution is exact-after-normalisation through the alias
// tables — never fuzzy. A name that could be more than one entity is NOT linked: it goes to
// the review queue (EntityMatchReview) and nothing attaches until a person picks.

export const CONFIDENCE = {
  /** Exact canonical name / registry actor. */
  canonical: 0.95,
  /** Matched through a stored alias. */
  alias: 0.85,
  /** A structured designation (ordinal + unit type; rank + name) that created a new stub. */
  createdFromPattern: 0.6,
} as const;

export interface LinkResult {
  linked: { kind: EntityKind; id: string; matchedText: string; method: string; confidence: number; created: boolean }[];
  needsReview: { kind: EntityKind; matchedText: string; candidates: string[] }[];
}

interface ItemLike {
  id: string;
  originalTitle: string | null;
  originalText: string | null;
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Known entity names/aliases (DB + registry text aliases) that appear in `text` as whole words. */
async function findKnownMentions(kind: EntityKind, text: string): Promise<{ matchedText: string; normalized: string }[]> {
  const rows = await prisma.entityAlias.findMany({ where: { entityKind: kind }, select: { alias: true, normalized: true, aliasType: true } });
  const out = new Map<string, { matchedText: string; normalized: string }>();
  for (const row of rows) {
    if (row.alias.length < 3) continue;
    // Short/abbreviated names must match case-exactly ("SAC", not "sac"); longer names ignore case.
    const caseSensitive = row.alias.length <= 5 || row.aliasType === "abbreviation";
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegex(row.alias)}(?![\\p{L}\\p{N}])`, caseSensitive ? "u" : "iu");
    const m = re.exec(text);
    if (m && !out.has(row.normalized)) out.set(row.normalized, { matchedText: m[0], normalized: row.normalized });
  }
  return [...out.values()];
}

/** Registry actor spellings found in the text ("the junta", "IDF") -> the normalised canonical name. */
function registryMentions(text: string): { matchedText: string; canonical: string }[] {
  const lower = text.toLowerCase();
  const found: { matchedText: string; canonical: string }[] = [];
  for (const [canonical, aliases] of textMatchTable()) {
    for (const alias of aliases) {
      const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegex(alias)}(?![\\p{L}\\p{N}])`, "u");
      if (re.test(lower)) {
        found.push({ matchedText: alias, canonical });
        break;
      }
    }
  }
  return found;
}

async function queueReview(itemId: string, kind: EntityKind, matchedText: string, candidates: string[], reason: string) {
  await prisma.entityMatchReview.upsert({
    where: { rawIngestionItemId_entityKind_matchedText: { rawIngestionItemId: itemId, entityKind: kind, matchedText } },
    update: {},
    create: { rawIngestionItemId: itemId, entityKind: kind, matchedText, candidateIds: JSON.stringify(candidates), reason },
  });
}

/** Links a report to the entities it names. Idempotent. */
export async function linkEntitiesFromReport(item: ItemLike, context: { country?: string | null; sourceName?: string | null } = {}): Promise<LinkResult> {
  const text = [item.originalTitle, item.originalText].filter(Boolean).join("\n");
  const result: LinkResult = { linked: [], needsReview: [] };
  if (!text) return result;
  const ctx = { country: context.country ?? null, source: context.sourceName ?? null };
  const provenance = { sourceName: context.sourceName ?? undefined };
  const seen = new Set<string>();

  const attach = async (kind: EntityKind, id: string, matchedText: string, method: string, confidence: number, created: boolean) => {
    const key = `${kind}:${id}`;
    if (seen.has(key)) return;
    seen.add(key);
    const meta = { matchedText, method, confidence };
    if (kind === "unit") await linkArticleToUnit(item.id, id, meta);
    else if (kind === "commander") await linkArticleToCommander(item.id, id, meta);
    else await linkArticleToEquipment(item.id, id, meta);
    result.linked.push({ kind, id, matchedText, method, confidence, created });
  };

  // Resolve one mention through the alias tables; returns the entity id or handles ambiguity.
  const resolveOrQueue = async (kind: EntityKind, name: string, matchedText: string): Promise<{ id: string; method: string; confidence: number } | null | "review"> => {
    const r = await resolveEntity(kind, name, ctx);
    if (r.status === "resolved") return { id: r.id, method: r.via === "alias" ? "alias" : "canonical_name", confidence: r.via === "alias" ? CONFIDENCE.alias : CONFIDENCE.canonical };
    if (r.status === "ambiguous") {
      await queueReview(item.id, kind, matchedText, r.candidates, `"${matchedText}" matches ${r.candidates.length} different ${kind === "unit" ? "actors/units" : kind === "commander" ? "commanders" : "equipment types"}.`);
      result.needsReview.push({ kind, matchedText, candidates: r.candidates });
      return "review";
    }
    return null;
  };

  // 1. Known units/actors/commanders/equipment named in the text (canonical names + stored aliases).
  for (const kind of ["unit", "commander", "equipment"] as const) {
    for (const m of await findKnownMentions(kind, text)) {
      const r = await resolveOrQueue(kind, m.matchedText, m.matchedText);
      if (r && r !== "review") await attach(kind, r.id, m.matchedText, r.method, r.confidence, false);
    }
  }
  // 2. Registry actor spellings ("the junta", "IDF"): link ONLY an actor that already exists — a passing mention never creates an entity.
  for (const m of registryMentions(text)) {
    const r = await resolveEntity("unit", m.canonical, ctx);
    if (r.status === "resolved") await attach("unit", r.id, m.matchedText, "registry_alias", CONFIDENCE.canonical, false);
    else if (r.status === "ambiguous") {
      await queueReview(item.id, "unit", m.matchedText, r.candidates, `"${m.matchedText}" matches ${r.candidates.length} different actors.`);
      result.needsReview.push({ kind: "unit", matchedText: m.matchedText, candidates: r.candidates });
    }
  }
  // 3. Structured designations that follow a naming convention (ordinal + unit type; rank + name; catalogued equipment).
  for (const mention of extractUnitMentions(text)) {
    const r = await resolveOrQueue("unit", mention.name, mention.matched);
    if (r === "review") continue;
    if (r) {
      await attach("unit", r.id, mention.matched, r.method, r.confidence, false);
      continue;
    }
    const unit = await findOrCreateMilitaryUnit({ name: mention.name, unitType: mention.unitType, country: context.country ?? undefined, ...provenance });
    await attach("unit", unit.id, mention.matched, "designation_pattern", CONFIDENCE.createdFromPattern, true);
  }
  for (const mention of extractCommanderMentions(text)) {
    const r = await resolveOrQueue("commander", mention.name, mention.matched);
    if (r === "review") continue;
    if (r) {
      await attach("commander", r.id, mention.matched, r.method, r.confidence, false);
      continue;
    }
    const commander = await findOrCreateCommander({ name: mention.name, rank: mention.rank, ...provenance });
    await attach("commander", commander.id, mention.matched, "rank_name_pattern", CONFIDENCE.createdFromPattern, true);
  }
  for (const mention of extractEquipmentMentions(text)) {
    const r = await resolveOrQueue("equipment", mention.name, mention.matched);
    if (r === "review") continue;
    if (r) {
      await attach("equipment", r.id, mention.matched, r.method, r.confidence, false);
      continue;
    }
    const equipment = await findOrCreateMilitaryEquipment({ name: mention.name, category: mention.category, ...provenance });
    await attach("equipment", equipment.id, mention.matched, "catalog", CONFIDENCE.canonical, true);
  }
  return result;
}

/** Report -> event: carries the report's resolved entity links onto the event. Units go to
 * MilitaryUnitEvent; commanders and equipment go to their event links ("observed in this event",
 * NOT "known operator" — that is a separate, sourced unit-equipment relationship). Only links
 * that already resolved are carried; review-queue items never are. */
export async function propagateEntityLinksToEvent(rawIngestionItemId: string, eventId: string): Promise<void> {
  const item = await prisma.rawIngestionItem.findUnique({ where: { id: rawIngestionItemId }, select: { originalUrl: true, source: { select: { name: true } } } });
  const provenance = { sourceName: item?.source.name ?? null, sourceUrl: item?.originalUrl ?? null };
  const [units, commanders, equipment] = await Promise.all([
    prisma.articleMilitaryUnitLink.findMany({ where: { rawIngestionItemId } }),
    prisma.articleMilitaryCommanderLink.findMany({ where: { rawIngestionItemId } }),
    prisma.articleMilitaryEquipmentLink.findMany({ where: { rawIngestionItemId } }),
  ]);
  for (const l of units) await linkUnitToEvent(l.unitId, eventId, provenance);
  for (const l of commanders) {
    await prisma.eventCommanderLink.upsert({ where: { eventId_commanderId: { eventId, commanderId: l.commanderId } }, update: {}, create: { eventId, commanderId: l.commanderId, matchedText: l.matchedText, confidence: l.confidence, ...provenance } });
  }
  for (const l of equipment) {
    await prisma.eventEquipmentLink.upsert({ where: { eventId_equipmentId: { eventId, equipmentId: l.equipmentId } }, update: {}, create: { eventId, equipmentId: l.equipmentId, matchedText: l.matchedText, confidence: l.confidence, ...provenance } });
  }
}

/** Resolves a queued ambiguous mention to the chosen entity: creates the link and closes the review. */
export async function resolveMatchReview(reviewId: string, entityId: string | null): Promise<{ ok: boolean; reason?: string }> {
  const review = await prisma.entityMatchReview.findUnique({ where: { id: reviewId } });
  if (!review || review.status !== "pending") return { ok: false, reason: "Review not found or already resolved." };
  if (entityId === null) {
    await prisma.entityMatchReview.update({ where: { id: reviewId }, data: { status: "dismissed", resolvedAt: new Date() } });
    return { ok: true };
  }
  const candidates = JSON.parse(review.candidateIds) as string[];
  if (!candidates.includes(entityId)) return { ok: false, reason: "The chosen entity is not one of the candidates." };
  const meta = { matchedText: review.matchedText, method: "manual_review", confidence: 1 };
  if (review.entityKind === "unit") await linkArticleToUnit(review.rawIngestionItemId, entityId, meta);
  else if (review.entityKind === "commander") await linkArticleToCommander(review.rawIngestionItemId, entityId, meta);
  else await linkArticleToEquipment(review.rawIngestionItemId, entityId, meta);
  await prisma.entityMatchReview.update({ where: { id: reviewId }, data: { status: "resolved", resolvedEntityId: entityId, resolvedAt: new Date() } });
  // If the report already became an event, carry the newly confirmed link over too.
  const links = await prisma.eventSource.findMany({ where: { rawIngestionItemId: review.rawIngestionItemId }, select: { eventId: true } });
  for (const l of links) await propagateEntityLinksToEvent(review.rawIngestionItemId, l.eventId);
  return { ok: true };
}

export { normalizeEntityText };
