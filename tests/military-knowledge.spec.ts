import { test, expect } from "@playwright/test";
import { describeFreshness, relationshipFreshness } from "@/lib/military/freshness";
import { normalizeEntityText } from "@/lib/military/aliases";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Military & Actor Intelligence Knowledge Layer: one canonical entity model, alias resolution that
// never guesses, relationship history + provenance, extraction that routes ambiguity to review,
// and public pages built from real rows (no coordinates, no inferred alliances).

const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const DAY = 86_400_000;
const NOW = new Date("2026-09-20T12:00:00Z").getTime();
const PREFIX = "MK ";

test.beforeAll(async () => {
  const { prisma } = await import("@/lib/db/client");
  await prisma.entityMatchReview.deleteMany({ where: { matchedText: { startsWith: PREFIX } } });
  await prisma.militaryUnit.deleteMany({ where: { name: { startsWith: PREFIX } } });
  await prisma.commander.deleteMany({ where: { name: { startsWith: PREFIX } } });
  await prisma.militaryEquipment.deleteMany({ where: { name: { startsWith: PREFIX } } });
});

async function makeUnit(name: string, extra: Record<string, unknown> = {}) {
  const { prisma } = await import("@/lib/db/client");
  const { ensureCanonicalAlias } = await import("@/lib/military/aliases");
  const u = await prisma.militaryUnit.create({ data: { name, ...extra } });
  await ensureCanonicalAlias("unit", u.id, name);
  return u;
}

test.describe("Pure helpers", () => {
  test("alias normalisation folds case, diacritics and punctuation; freshness labels are honest", () => {
    expect(normalizeEntityText("  The Tatmadaw ")).toBe(normalizeEntityText("TATMADAW"));
    expect(normalizeEntityText("Zaïts-Group")).toBe(normalizeEntityText("zaits-group"));
    expect(relationshipFreshness(new Date(NOW - 3 * DAY).toISOString(), NOW).state).toBe("fresh");
    expect(relationshipFreshness(new Date(NOW - 400 * DAY).toISOString(), NOW).state).toBe("stale");
    expect(relationshipFreshness(null, NOW).state).toBe("unknown");
    expect(describeFreshness("Last confirmed", new Date(NOW - 130 * DAY).toISOString(), NOW)).toMatch(/months ago/);
    expect(describeFreshness("Last sourced", null, NOW)).toContain("date unknown");
  });

  test("the Node-side alias normaliser stays in step with the seed script copy", async () => {
    const seed = readFileSync(join(process.cwd(), "prisma", "entity-text.mjs"), "utf8");
    expect(seed).toContain("normalizeEntityText");
    // @ts-expect-error plain .mjs without a declaration file
    const mod = (await import("../prisma/entity-text.mjs")) as { normalizeEntityText: (s: string) => string };
    for (const s of ["Tatmadaw", "  Zaïts-Group ", "82nd Airborne Div.", "Ünit №5"]) expect(mod.normalizeEntityText(s)).toBe(normalizeEntityText(s));
  });
});

test.describe("Aliases and canonical entities", () => {
  test("an alias resolves to the canonical entity; similar names are not merged; a second entity cannot steal an alias", async () => {
    const { resolveEntity, addEntityAlias } = await import("@/lib/military/aliases");
    const id = unique();
    const a = await makeUnit(`${PREFIX}Alpha Brigade ${id}`);
    const b = await makeUnit(`${PREFIX}Alpha Brigade ${id} Reserve`);
    expect((await addEntityAlias("unit", a.id, `MK-AB ${id}`, { aliasType: "abbreviation" })).ok).toBe(true);
    const hit = await resolveEntity("unit", `mk-ab ${id}`);
    expect(hit).toMatchObject({ status: "resolved", id: a.id });
    // Near-identical names stay separate entities.
    expect(await resolveEntity("unit", `${PREFIX}Alpha Brigade ${id}`)).toMatchObject({ id: a.id });
    expect(await resolveEntity("unit", `${PREFIX}Alpha Brigade ${id} Reserve`)).toMatchObject({ id: b.id });
    expect(await resolveEntity("unit", `${PREFIX}Alpha Brigad ${id}`)).toEqual({ status: "unknown" });
    // The same alias on another entity is refused rather than silently duplicated.
    const dup = await addEntityAlias("unit", b.id, `MK-AB ${id}`, { aliasType: "abbreviation" });
    expect(dup.ok).toBe(false);
  });

  test("an ambiguous alias resolves to no entity", async () => {
    const { resolveEntity, addEntityAlias } = await import("@/lib/military/aliases");
    const id = unique();
    const a = await makeUnit(`${PREFIX}North Guard ${id}`, { country: "AA" });
    const b = await makeUnit(`${PREFIX}South Guard ${id}`, { country: "BB" });
    await addEntityAlias("unit", a.id, `MK 1st Guards ${id}`, { aliasType: "source_specific", countryScope: "AA" });
    await addEntityAlias("unit", b.id, `MK 1st Guards ${id}`, { aliasType: "source_specific", countryScope: "BB" });
    expect(await resolveEntity("unit", `MK 1st Guards ${id}`, { country: "AA" })).toMatchObject({ status: "resolved", id: a.id });
    expect(await resolveEntity("unit", `MK 1st Guards ${id}`, { country: "BB" })).toMatchObject({ status: "resolved", id: b.id });
    expect((await resolveEntity("unit", `MK 1st Guards ${id}`)).status).not.toBe("resolved");
  });
});

test.describe("Relationship history and provenance", () => {
  test("unit hierarchy keeps history: changing the parent closes the old row instead of overwriting", async () => {
    const { prisma } = await import("@/lib/db/client");
    const { setUnitParent } = await import("@/lib/military/knowledge");
    const id = unique();
    const p1 = await makeUnit(`${PREFIX}Corps A ${id}`);
    const p2 = await makeUnit(`${PREFIX}Corps B ${id}`);
    const child = await makeUnit(`${PREFIX}Battalion ${id}`);
    await setUnitParent(child.id, p1.id, { sourceName: "Ref", sourceUrl: "https://ref.test/a", confidence: 0.9, observedAt: new Date(NOW - 200 * DAY) });
    expect((await setUnitParent(child.id, p1.id, {})).changed).toBe(false);
    await setUnitParent(child.id, p2.id, { sourceName: "Ref", sourceUrl: "https://ref.test/b" });
    const current = await prisma.militaryUnit.findUnique({ where: { id: child.id } });
    expect(current?.parentUnitId).toBe(p2.id);
    const hist = await prisma.unitParentHistory.findMany({ where: { unitId: child.id }, orderBy: { createdAt: "asc" } });
    expect(hist).toHaveLength(2);
    expect(hist[0]).toMatchObject({ parentUnitId: p1.id, sourceUrl: "https://ref.test/a" });
    expect(hist[0]!.validTo).not.toBeNull();
    expect(hist[1]!.validTo).toBeNull();
    // A cycle is refused.
    await expect(setUnitParent(p2.id, child.id, {})).rejects.toThrow();
  });

  test("commander appointment history is preserved and the previous appointment is closed", async () => {
    const { prisma } = await import("@/lib/db/client");
    const { appointCommander } = await import("@/lib/military/knowledge");
    const id = unique();
    const u1 = await makeUnit(`${PREFIX}Div One ${id}`);
    const u2 = await makeUnit(`${PREFIX}Div Two ${id}`);
    const cmd = await prisma.commander.create({ data: { name: `${PREFIX}Cmdr ${id}`, rank: "General" } });
    await appointCommander(cmd.id, u1.id, { role: "commander", sourceUrl: "https://ref.test/c1", startDate: new Date("2024-01-01") });
    await appointCommander(cmd.id, u2.id, { role: "commander", sourceUrl: "https://ref.test/c2", startDate: new Date("2025-06-01") });
    const rows = await prisma.commanderAppointment.findMany({ where: { commanderId: cmd.id }, orderBy: { createdAt: "asc" } });
    expect(rows).toHaveLength(2);
    expect(rows[0]!.endDate).not.toBeNull();
    expect(rows[1]!.endDate).toBeNull();
    expect(rows[0]!.sourceUrl).toBe("https://ref.test/c1");
  });

  test("explicit actor relationships need a source and are stored once", async () => {
    const { addActorRelationship } = await import("@/lib/military/knowledge");
    const { prisma } = await import("@/lib/db/client");
    const id = unique();
    const a = await makeUnit(`${PREFIX}Group X ${id}`);
    const b = await makeUnit(`${PREFIX}Group Y ${id}`);
    await addActorRelationship(a.id, b.id, "allied", { sourceName: "Analysis", sourceUrl: "https://ref.test/rel" });
    const again = await addActorRelationship(a.id, b.id, "allied", { sourceName: "Analysis", sourceUrl: "https://ref.test/rel" });
    expect(again.created).toBe(false);
    expect(await prisma.actorRelationship.count({ where: { fromId: a.id, toId: b.id } })).toBe(1);
  });
});

test.describe("Event entity extraction", () => {
  async function rawItem(title: string, text: string) {
    const { prisma } = await import("@/lib/db/client");
    const source = await prisma.source.create({ data: { name: `MK source ${unique()}`, type: "manual", enabled: false } });
    return prisma.rawIngestionItem.create({ data: { sourceId: source.id, externalId: unique(), originalTitle: title, originalText: text, originalUrl: "https://publisher.test/mk" } });
  }

  test("a report naming a known unit, via canonical name and via alias, links it once with method and confidence", async () => {
    const { linkEntitiesFromReport } = await import("@/lib/military/link-entities");
    const { addEntityAlias } = await import("@/lib/military/aliases");
    const { prisma } = await import("@/lib/db/client");
    const id = unique();
    const unit = await makeUnit(`${PREFIX}Vanguard Force ${id}`);
    await addEntityAlias("unit", unit.id, `MKVF${id.replace(/\W/g, "")}`, { aliasType: "abbreviation" });
    const item = await rawItem(`${PREFIX}Vanguard Force ${id} reported near the river`, `Officials said ${PREFIX}Vanguard Force ${id} and MKVF${id.replace(/\W/g, "")} were involved.`);
    const r1 = await linkEntitiesFromReport(item);
    const hits = r1.linked.filter((l) => l.id === unit.id);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => h.confidence >= 0.85)).toBe(true);
    await linkEntitiesFromReport(item); // idempotent
    expect(await prisma.articleMilitaryUnitLink.count({ where: { rawIngestionItemId: item.id, unitId: unit.id } })).toBe(1);
    const link = await prisma.articleMilitaryUnitLink.findFirst({ where: { rawIngestionItemId: item.id, unitId: unit.id } });
    expect(link?.matchedText).toBeTruthy();
    expect(link?.method).toBeTruthy();
  });

  test("an ambiguous mention is queued for review and never silently attached; resolving it creates the link", async () => {
    const { linkEntitiesFromReport, resolveMatchReview } = await import("@/lib/military/link-entities");
    const { addEntityAlias } = await import("@/lib/military/aliases");
    const { prisma } = await import("@/lib/db/client");
    const id = unique();
    const tag = `MKAMB${id.replace(/\W/g, "")}`;
    const a = await makeUnit(`${PREFIX}Ambig One ${id}`);
    const b = await makeUnit(`${PREFIX}Ambig Two ${id}`);
    await addEntityAlias("unit", a.id, tag, { aliasType: "abbreviation" });
    await addEntityAlias("unit", b.id, tag, { aliasType: "abbreviation" }).catch(() => undefined);
    // Force the ambiguity even if the API refused the second alias: write it directly.
    const { normalizeEntityText: norm } = await import("@/lib/military/aliases");
    if ((await prisma.entityAlias.count({ where: { normalized: norm(tag) } })) < 2) {
      await prisma.entityAlias.create({ data: { entityKind: "unit", entityId: b.id, alias: tag, normalized: norm(tag), aliasType: "abbreviation" } });
    }
    const item = await rawItem(`${PREFIX}report`, `Fighting involving ${tag} was reported.`);
    const res = await linkEntitiesFromReport(item);
    expect(res.linked.some((l) => l.id === a.id || l.id === b.id)).toBe(false);
    expect(res.needsReview.length).toBeGreaterThan(0);
    expect(await prisma.articleMilitaryUnitLink.count({ where: { rawIngestionItemId: item.id } })).toBe(0);
    const review = await prisma.entityMatchReview.findFirstOrThrow({ where: { rawIngestionItemId: item.id } });
    const done = await resolveMatchReview(review.id, a.id);
    expect(done.ok).toBe(true);
    expect(await prisma.articleMilitaryUnitLink.count({ where: { rawIngestionItemId: item.id, unitId: a.id } })).toBe(1);
  });
});

test.describe("Public pages and search use real data", () => {
  test("unit, commander and equipment pages render database rows with provenance, staleness and no coordinates", async ({ page }) => {
    const { prisma } = await import("@/lib/db/client");
    const { appointCommander, setUnitParent } = await import("@/lib/military/knowledge");
    const id = unique();
    const parent = await makeUnit(`${PREFIX}Parent Command ${id}`, { entityType: "state_military", country: "ZQ" });
    const unit = await makeUnit(`${PREFIX}Field Unit ${id}`, { entityType: "military_unit", country: "ZQ", sourceName: "Ref", sourceUrl: "https://ref.test/unit" });
    await setUnitParent(unit.id, parent.id, { sourceName: "Ref", sourceUrl: "https://ref.test/parent", observedAt: new Date(Date.now() - 300 * DAY) });
    const cmd = await prisma.commander.create({ data: { name: `${PREFIX}Cmdr Page ${id}`, rank: "Colonel" } });
    await appointCommander(cmd.id, unit.id, { role: "commander", sourceName: "Ref", sourceUrl: "https://ref.test/cmd", observedAt: new Date(Date.now() - 3 * DAY) });
    const eq = await prisma.militaryEquipment.create({ data: { name: `${PREFIX}Tank ${id}`, category: "tank" } });
    await prisma.militaryUnitEquipment.create({ data: { unitId: unit.id, equipmentId: eq.id, sourceName: "Ref", sourceUrl: "https://ref.test/eq", observedAt: new Date(Date.now() - DAY) } });

    await page.goto(`/unit/${unit.id}`);
    await expect(page.getByTestId("unit-name")).toContainText(unit.name);
    await expect(page.getByTestId("unit-organization")).toContainText(parent.name);
    await expect(page.getByTestId("unit-commander")).toContainText(cmd.name);
    await expect(page.getByTestId("unit-equipment-item")).toContainText(eq.name);
    await expect(page.getByTestId("unit-last-observed")).toBeVisible();
    await expect(page.getByTestId("stale-relationship").first()).toBeVisible(); // parent link observed 300 days ago
    await expect(page.getByTestId("original-source-link").first()).toBeVisible();
    const body = await page.locator("body").innerText();
    expect(body).not.toMatch(/\b-?\d{1,2}\.\d{3,},\s*-?\d{1,3}\.\d{3,}\b/); // no lat,lon pairs

    await page.goto(`/actor/${unit.id}`); // military units redirect to the unit page
    await expect(page).toHaveURL(new RegExp(`/unit/${unit.id}`));

    await page.goto(`/commander/${cmd.id}`);
    await expect(page.getByTestId("commander-name")).toContainText(cmd.name);
    await expect(page.getByTestId("commander-appointment")).toContainText(unit.name);

    await page.goto(`/equipment/${eq.id}`);
    await expect(page.getByTestId("equipment-name")).toContainText(eq.name);
    await expect(page.getByTestId("equipment-operator")).toContainText(unit.name);
  });

  test("public search resolves an alias to its canonical entity", async ({ request }) => {
    const { addEntityAlias } = await import("@/lib/military/aliases");
    const id = unique();
    const unit = await makeUnit(`${PREFIX}Ninth Airborne Division ${id}`, { entityType: "military_unit" });
    const alias = `MK9ABN${id.replace(/\W/g, "")}`;
    await addEntityAlias("unit", unit.id, alias, { aliasType: "abbreviation" });
    const res = (await request.get(`/api/public/search?q=${encodeURIComponent(alias)}`).then((r) => r.json())) as { results?: { title: string; href: string }[] } | { title: string; href: string }[];
    const list = Array.isArray(res) ? res : (res.results ?? []);
    const hit = list.find((r) => r.href.includes(unit.id));
    expect(hit?.title).toBe(unit.name);
  });

  test("territorial-control actor links still resolve to the entity page", async ({ page }) => {
    const { prisma } = await import("@/lib/db/client");
    const id = unique();
    const unit = await makeUnit(`${PREFIX}Territory Actor ${id}`, { entityType: "armed_group" });
    await page.goto(`/actor/${unit.id}`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(unit.name);
    expect(await prisma.militaryUnit.count({ where: { id: unit.id } })).toBe(1);
  });
});

test.describe("Admin audit", () => {
  test("audit filters find untyped entities and ones with missing provenance; explicit relationships require a source", async ({ request }) => {
    const id = unique();
    const unit = await makeUnit(`${PREFIX}Audit Unit ${id}`);
    const other = await makeUnit(`${PREFIX}Audit Other ${id}`);
    const audit = (await request.get(`/api/admin/military-audit?flag=untyped&q=${encodeURIComponent(`Audit Unit ${id}`)}`).then((r) => r.json())) as { rows: { id: string; flags: string[] }[] };
    expect(audit.rows.find((r) => r.id === unit.id)?.flags).toContain("untyped");
    const noSource = await request.post(`/api/admin/military-units/${unit.id}/relationships`, { data: { action: "add_relationship", otherId: other.id, relationType: "allied" } });
    expect(noSource.status()).toBe(400);
    const ok = await request.post(`/api/admin/military-units/${unit.id}/relationships`, { data: { action: "add_relationship", otherId: other.id, relationType: "allied", sourceName: "Analysis", sourceUrl: "https://ref.test/x" } });
    expect(ok.ok()).toBe(true);
    const inspect = (await request.get(`/api/admin/military-units/${unit.id}/relationships`).then((r) => r.json())) as { relationships: unknown[] };
    expect(inspect.relationships).toHaveLength(1);
  });
});
