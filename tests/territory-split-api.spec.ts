import { test, expect, type APIRequestContext } from "@playwright/test";
import { planarArea, sameArea } from "@/lib/territory/geometry";
import type { TerritorialGeometry } from "@/lib/types/territorial-control";

// Split / partial control change, geometry validation on every write path,
// and the territorial-change candidate -> drawn geometry -> published flow.
// Each test builds its own conflict ("te-...") and removes it afterwards.

const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const square = (x0: number, y0: number, x1: number, y1: number): TerritorialGeometry => ({
  type: "Polygon",
  coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]],
});
const BOWTIE = { type: "Polygon", coordinates: [[[0, 0], [10, 10], [10, 0], [0, 10], [0, 0]]] };
// Far from every seeded/other test polygon, inside valid lat/lng.
const BASE = square(-60, -30, -50, -20); // 10 x 10
const AREA = square(-55, -35, -45, -15); // overlaps the right half of BASE (and outside)

interface World {
  conflictId: string;
  a: { id: string; name: string };
  b: { id: string; name: string };
  baseId: string;
  baseFrom: string;
}

type Api = APIRequestContext;

async function makeWorld(request: Api): Promise<World> {
  const tag = unique();
  const conflict = await request.post("/api/admin/conflicts", { data: { slug: `te-${tag}`, name: `TE ${tag}`, region: "Asia", severity: "guarded", intensity: 30 } }).then((r) => r.json());
  const a = await request.post("/api/admin/actors", { data: { conflictId: conflict.id, name: `Alpha ${tag}` } }).then((r) => r.json());
  const b = await request.post("/api/admin/actors", { data: { conflictId: conflict.id, name: `Bravo ${tag}` } }).then((r) => r.json());
  const baseFrom = new Date(Date.now() - 72 * 3600_000).toISOString();
  const draft = await request
    .post("/api/admin/territorial-control", {
      data: { conflictId: conflict.id, actorId: a.id, status: "controlled", confidence: 0.8, geometry: BASE, sourceName: "Original mapper", sourceUrl: "https://fixture.test/original", validFrom: baseFrom },
    })
    .then((r) => r.json());
  expect((await request.post(`/api/admin/territorial-control/${draft.id}/publish`)).ok()).toBe(true);
  return { conflictId: conflict.id, a, b, baseId: draft.id, baseFrom };
}

async function rows(request: Api, conflictId: string) {
  const all = (await request.get("/api/admin/territorial-control").then((r) => r.json())) as Record<string, any>[];
  return all.filter((t) => t.conflictId === conflictId);
}

async function publicAt(request: Api, at: Date) {
  const collection = await request.get(`/api/territorial-control?at=${encodeURIComponent(at.toISOString())}`).then((r) => r.json());
  return collection.features as { id: string; geometry: TerritorialGeometry; properties: Record<string, any> }[];
}

async function createSplitDraft(request: Api, w: World, overrides: Record<string, unknown> = {}) {
  return request.post("/api/admin/territorial-control", {
    data: {
      conflictId: w.conflictId,
      actorId: w.b.id,
      status: "controlled",
      confidence: 0.6,
      geometry: AREA,
      sourceName: "Change report",
      sourceUrl: "https://fixture.test/change",
      validFrom: new Date(Date.now() - 3600_000).toISOString(),
      splitFromId: w.baseId,
      ...overrides,
    },
  });
}

test.afterAll(async () => {
  const { prisma } = await import("@/lib/db/client");
  await prisma.conflict.deleteMany({ where: { slug: { startsWith: "te-" } } });
});

test.describe("Geometry validation on every write path", () => {
  test("create, edit, supersede and publish all reject invalid geometry with clear messages and store nothing", async ({ request }) => {
    const w = await makeWorld(request);
    const before = (await rows(request, w.conflictId)).length;

    const create = await request.post("/api/admin/territorial-control", { data: { conflictId: w.conflictId, actorId: w.a.id, status: "controlled", confidence: 0.5, geometry: BOWTIE, validFrom: new Date().toISOString() } });
    expect(create.status()).toBe(400);
    const body = await create.json();
    expect(body.error).toMatch(/crosses itself/);
    expect(body.errors).toHaveLength(1);
    expect((await rows(request, w.conflictId)).length).toBe(before);

    const offWorld = await request.post("/api/admin/territorial-control", { data: { conflictId: w.conflictId, status: "uncertain", confidence: 0.5, geometry: square(0, 0, 200, 10), validFrom: new Date().toISOString() } });
    expect(offWorld.status()).toBe(400);
    expect((await offWorld.json()).error).toMatch(/longitude 200/);

    const draft = await request.post("/api/admin/territorial-control", { data: { conflictId: w.conflictId, status: "uncertain", confidence: 0.5, geometry: square(0, 0, 5, 5), validFrom: new Date().toISOString() } }).then((r) => r.json());
    expect((await request.patch(`/api/admin/territorial-control/${draft.id}`, { data: { geometry: BOWTIE } })).status()).toBe(400);

    const supersede = await request.post(`/api/admin/territorial-control/${w.baseId}/supersede`, { data: { status: "controlled", confidence: 0.5, geometry: BOWTIE, validFrom: new Date().toISOString() } });
    expect(supersede.status()).toBe(400);
    expect((await rows(request, w.conflictId)).find((t) => t.id === w.baseId)!.validTo).toBeNull(); // still active

    // The publish step re-validates whatever is stored, so an invalid draft can never go live.
    const { prisma } = await import("@/lib/db/client");
    await prisma.conflictTerritory.update({ where: { id: draft.id }, data: { geometry: JSON.stringify(BOWTIE) } });
    const publish = await request.post(`/api/admin/territorial-control/${draft.id}/publish`);
    expect(publish.status()).toBe(400);
    expect((await rows(request, w.conflictId)).find((t) => t.id === draft.id)!.published).toBe(false);
  });

  test("'recently_changed' can't be assigned by hand (it stays derived)", async ({ request }) => {
    const w = await makeWorld(request);
    const res = await request.post("/api/admin/territorial-control", { data: { conflictId: w.conflictId, status: "recently_changed", confidence: 0.5, geometry: square(0, 0, 5, 5), validFrom: new Date().toISOString() } });
    expect(res.status()).toBe(400);
  });

  test("validate and preview endpoints report problems without writing", async ({ request }) => {
    const w = await makeWorld(request);
    const invalid = await request.post("/api/admin/territorial-control/validate", { data: { geometry: BOWTIE } }).then((r) => r.json());
    expect(invalid.valid).toBe(false);
    const preview = await request.post("/api/admin/territorial-control/preview-split", { data: { sourceId: w.baseId, geometry: AREA } }).then((r) => r.json());
    expect(preview.valid).toBe(true);
    expect(preview.areaOutsideBase).toBe(true);
    expect(planarArea(preview.affected)).toBeCloseTo(50, 6);
    expect(planarArea(preview.remainder)).toBeCloseTo(50, 6);
    expect((await rows(request, w.conflictId)).length).toBe(1);
    const none = await request.post("/api/admin/territorial-control/preview-split", { data: { sourceId: w.baseId, geometry: square(10, 10, 20, 20) } }).then((r) => r.json());
    expect(none.valid).toBe(false);
    expect(none.errors[0]).toMatch(/does not overlap/);
  });
});

test.describe("Split / partial control change", () => {
  test("publishing a split draft changes only the affected area and versions both halves", async ({ request }) => {
    const w = await makeWorld(request);
    const changeAt = new Date(Date.now() - 3600_000);
    const draftRes = await createSplitDraft(request, w, { validFrom: changeAt.toISOString() });
    expect(draftRes.status()).toBe(201);
    const draft = await draftRes.json();
    expect(draft).toMatchObject({ published: false, splitFromId: w.baseId });
    // The draft alone changes nothing public.
    expect((await rows(request, w.conflictId)).find((t) => t.id === w.baseId)!.validTo).toBeNull();

    const published = await request.post(`/api/admin/territorial-control/${draft.id}/publish`);
    expect(published.ok()).toBe(true);

    const all = await rows(request, w.conflictId);
    expect(all).toHaveLength(3);
    const old = all.find((t) => t.id === w.baseId)!;
    const affected = all.find((t) => t.id === draft.id)!;
    const remainder = all.find((t) => t.id !== w.baseId && t.id !== draft.id)!;

    // Old version: closed exactly at the change, otherwise untouched.
    expect(new Date(old.validTo).toISOString()).toBe(changeAt.toISOString());
    expect(old.geometry).toEqual(BASE);
    expect(old).toMatchObject({ actorName: w.a.name, status: "controlled", sourceName: "Original mapper", confidence: 0.8 });

    // New controller holds only the edited area (BASE ∩ AREA = x -55..-50).
    expect(affected).toMatchObject({ actorName: w.b.name, status: "controlled", published: true, validTo: null, splitFromId: w.baseId, sourceName: "Change report", sourceUrl: "https://fixture.test/change", confidence: 0.6 });
    expect(new Date(affected.validFrom).toISOString()).toBe(changeAt.toISOString());
    expect(sameArea(affected.geometry, square(-55, -30, -50, -20))).toBe(true);

    // The unaffected ground stays with the OLD controller, with its provenance, exactly complementary.
    expect(remainder).toMatchObject({ actorName: w.a.name, status: "controlled", published: true, validTo: null, splitFromId: w.baseId, sourceName: "Original mapper", sourceUrl: "https://fixture.test/original", confidence: 0.8 });
    expect(new Date(remainder.validFrom).toISOString()).toBe(changeAt.toISOString());
    expect(sameArea(remainder.geometry, square(-60, -30, -55, -20))).toBe(true);
    expect(planarArea(affected.geometry) + planarArea(remainder.geometry)).toBeCloseTo(planarArea(BASE), 9);
  });

  test("timeline: before the change the old whole polygon shows, after it the two halves show", async ({ request }) => {
    const w = await makeWorld(request);
    const changeAt = new Date(Date.now() - 3600_000);
    const draft = await (await createSplitDraft(request, w, { validFrom: changeAt.toISOString() })).json();
    await request.post(`/api/admin/territorial-control/${draft.id}/publish`);

    const mine = (fs: Awaited<ReturnType<typeof publicAt>>) => fs.filter((f) => f.properties.conflictId === w.conflictId);
    const before = mine(await publicAt(request, new Date(changeAt.getTime() - 60_000)));
    expect(before).toHaveLength(1);
    expect(before[0]!.id).toBe(w.baseId);
    expect(before[0]!.properties.actorName).toBe(w.a.name);
    expect(sameArea(before[0]!.geometry, BASE)).toBe(true);

    const after = mine(await publicAt(request, new Date()));
    expect(after).toHaveLength(2);
    expect(after.map((f) => f.properties.actorName).sort()).toEqual([w.a.name, w.b.name].sort());
    expect(after.some((f) => f.id === w.baseId)).toBe(false);
    const union = after.reduce((n, f) => n + planarArea(f.geometry), 0);
    expect(union).toBeCloseTo(planarArea(BASE), 9);
  });

  test("a split can also carry a status change (contested/uncertain) and actor 'none'", async ({ request }) => {
    const w = await makeWorld(request);
    const draft = await (await createSplitDraft(request, w, { actorId: null, status: "contested", geometry: square(-58, -28, -52, -22) })).json();
    await request.post(`/api/admin/territorial-control/${draft.id}/publish`);
    const all = await rows(request, w.conflictId);
    const affected = all.find((t) => t.id === draft.id)!;
    expect(affected).toMatchObject({ status: "contested", actorId: null });
    const remainder = all.find((t) => t.id !== w.baseId && t.id !== draft.id)!;
    expect(planarArea(remainder.geometry)).toBeCloseTo(100 - 36, 6); // ring-shaped remainder with a hole
    expect(remainder.actorName).toBe(w.a.name);
  });

  test("an area covering the whole polygon is a whole supersede: no remainder row", async ({ request }) => {
    const w = await makeWorld(request);
    const draft = await (await createSplitDraft(request, w, { geometry: square(-70, -40, -40, -10) })).json();
    expect((await request.post(`/api/admin/territorial-control/${draft.id}/publish`)).ok()).toBe(true);
    const all = await rows(request, w.conflictId);
    expect(all).toHaveLength(2);
    expect(sameArea(all.find((t) => t.id === draft.id)!.geometry, BASE)).toBe(true);
  });

  test("a draw that does not touch the polygon can't be published; nothing changes and the draft stays a draft", async ({ request }) => {
    const w = await makeWorld(request);
    const draft = await (await createSplitDraft(request, w, { geometry: square(10, 10, 20, 20) })).json();
    const res = await request.post(`/api/admin/territorial-control/${draft.id}/publish`);
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toMatch(/does not overlap/);
    const all = await rows(request, w.conflictId);
    expect(all.find((t) => t.id === w.baseId)!.validTo).toBeNull();
    expect(all.find((t) => t.id === draft.id)!.published).toBe(false);
  });

  test("splitting a version that is not active, not published or from another conflict is refused", async ({ request }) => {
    const w = await makeWorld(request);
    const w2 = await makeWorld(request);
    // Other conflict.
    expect((await createSplitDraft(request, w, { splitFromId: w2.baseId })).status()).toBe(400);
    // Unpublished draft as the source.
    const plain = await request.post("/api/admin/territorial-control", { data: { conflictId: w.conflictId, status: "uncertain", confidence: 0.4, geometry: square(0, 0, 5, 5), validFrom: new Date().toISOString() } }).then((r) => r.json());
    expect((await createSplitDraft(request, w, { splitFromId: plain.id })).status()).toBe(400);
    // Already-superseded source: after a split the old id is closed.
    const draft = await (await createSplitDraft(request, w)).json();
    await request.post(`/api/admin/territorial-control/${draft.id}/publish`);
    const again = await createSplitDraft(request, w);
    expect(again.status()).toBe(400);
    expect((await again.json()).error).toMatch(/superseded/);
  });

  test("editing a whole polygon's shape publishes as a new version (reshape) and keeps the old geometry", async ({ request }) => {
    const w = await makeWorld(request);
    const reshaped = square(-60, -30, -48, -20);
    const res = await request.post(`/api/admin/territorial-control/${w.baseId}/supersede`, {
      data: { actorId: w.a.id, status: "controlled", confidence: 0.8, geometry: reshaped, sourceName: "Survey update", validFrom: new Date(Date.now() - 1800_000).toISOString() },
    });
    expect(res.status()).toBe(201);
    const all = await rows(request, w.conflictId);
    expect(all.find((t) => t.id === w.baseId)!.geometry).toEqual(BASE);
    expect(all.find((t) => t.id !== w.baseId)!.geometry).toEqual(reshaped);
  });
});

// ---------------------------------------------------------------------------

async function makeUnits(request: Api, w: World) {
  const unitA = await request.post("/api/admin/military-units", { data: { name: w.a.name } }).then((r) => r.json());
  const unitB = await request.post("/api/admin/military-units", { data: { name: w.b.name } }).then((r) => r.json());
  return { unitA, unitB };
}

async function makeCandidate(request: Api, w: World, unitA: { id: string }, unitB: { id: string }, overrides: Record<string, unknown> = {}) {
  const res = await request.post("/api/admin/territorial-change-candidates", {
    data: {
      conflictId: w.conflictId,
      description: "Reported change of control",
      changeType: "captured",
      claimedActorId: unitB.id,
      previousActorId: unitA.id,
      locationName: `Town ${unique()}`,
      lat: -25,
      lng: -52,
      precision: "approximate",
      sourceName: "Candidate wire",
      sourceUrl: `https://fixture.test/cand/${unique()}`,
      observedAt: new Date(Date.now() - 3600_000).toISOString(),
      ...overrides,
    },
  });
  expect(res.status()).toBe(201);
  return (await res.json()) as { id: string; locationName: string };
}

const review = (request: Api, id: string, data: Record<string, unknown>) => request.post(`/api/admin/territorial-change-candidates/${id}/review`, { data });
const candidate = (request: Api, id: string) => request.get(`/api/admin/territorial-change-candidates/${id}`).then((r) => r.json());

test.describe("Territorial change candidate -> drawn geometry -> published", () => {
  test("a pending-geometry candidate is drawn, previewed, and only published on explicit confirmation", async ({ request }) => {
    const w = await makeWorld(request);
    const { unitA, unitB } = await makeUnits(request, w);
    // Unknown precision: no coordinates, so it can't be matched to the polygon -> pending geometry.
    const c = await makeCandidate(request, w, unitA, unitB, { precision: "unknown", lat: null, lng: null });
    const approved = await (await review(request, c.id, { action: "approve" })).json();
    expect(approved).toMatchObject({ status: "approved", geometryPending: true, appliedTerritoryId: null });
    const before = await rows(request, w.conflictId);

    const area = square(-40, -12, -35, -8); // admin-drawn, away from the base
    const preview = await request.post(`/api/admin/territorial-change-candidates/${c.id}/preview-geometry`, { data: { geometry: area } }).then((r) => r.json());
    expect(preview).toMatchObject({ valid: true, sourceTerritoryId: null, proposedActorName: w.b.name, proposedStatus: "controlled" });
    expect(await rows(request, w.conflictId)).toEqual(before); // preview wrote nothing

    const unconfirmed = await request.post(`/api/admin/territorial-change-candidates/${c.id}/apply-geometry`, { data: { geometry: area } });
    expect(unconfirmed.status()).toBe(400);
    expect((await unconfirmed.json()).error).toMatch(/confirm/i);
    expect((await request.post(`/api/admin/territorial-change-candidates/${c.id}/apply-geometry`, { data: { geometry: BOWTIE, confirm: true } })).status()).toBe(400);
    expect(await rows(request, w.conflictId)).toEqual(before);

    const done = await request.post(`/api/admin/territorial-change-candidates/${c.id}/apply-geometry`, { data: { geometry: area, confirm: true } });
    expect(done.ok()).toBe(true);
    const applied = await done.json();
    expect(applied).toMatchObject({ status: "approved", geometryPending: false });
    const created = (await rows(request, w.conflictId)).find((t) => t.id === applied.appliedTerritoryId)!;
    // Actor / status / provenance carried from the candidate; geometry is exactly what the admin drew.
    expect(created).toMatchObject({ actorName: w.b.name, status: "controlled", published: true, sourceName: "Candidate wire", confidence: 0.4 });
    expect(created.geometry).toEqual(area);
    // The untouched base is unchanged.
    expect((await rows(request, w.conflictId)).find((t) => t.id === w.baseId)!.validTo).toBeNull();
  });

  test("with a current territory at the reported point, drawing only the affected area splits it: unaffected ground stays with the old controller", async ({ request }) => {
    const w = await makeWorld(request);
    const { unitA, unitB } = await makeUnits(request, w);
    const c = await makeCandidate(request, w, unitA, unitB); // approximate point (-52,-25) inside BASE
    const detail = await candidate(request, c.id);
    expect(detail.comparison).toMatchObject({ currentTerritoryId: w.baseId, currentActorName: w.a.name, proposedActorName: w.b.name });

    const town = square(-54, -26, -50, -22); // just the town-level area inside BASE
    const preview = await request.post(`/api/admin/territorial-change-candidates/${c.id}/preview-geometry`, { data: { geometry: town } }).then((r) => r.json());
    expect(preview.sourceTerritoryId).toBe(w.baseId);
    expect(planarArea(preview.affected)).toBeCloseTo(16, 6);
    expect(planarArea(preview.remainder)).toBeCloseTo(84, 6);

    const res = await request.post(`/api/admin/territorial-change-candidates/${c.id}/apply-geometry`, { data: { geometry: town, confirm: true } });
    expect(res.ok()).toBe(true);
    const applied = await res.json();
    const all = await rows(request, w.conflictId);
    expect(all).toHaveLength(3);
    const old = all.find((t) => t.id === w.baseId)!;
    const affected = all.find((t) => t.id === applied.appliedTerritoryId)!;
    const remainder = all.find((t) => t.id !== w.baseId && t.id !== applied.appliedTerritoryId)!;
    expect(old.validTo).not.toBeNull();
    expect(old.geometry).toEqual(BASE);
    expect(affected).toMatchObject({ actorName: w.b.name, sourceName: "Candidate wire" });
    expect(sameArea(affected.geometry, town)).toBe(true);
    expect(remainder).toMatchObject({ actorName: w.a.name, sourceName: "Original mapper" });
    expect(planarArea(remainder.geometry)).toBeCloseTo(84, 6);
    // The candidate is applied; a second apply is refused.
    expect((await request.post(`/api/admin/territorial-change-candidates/${c.id}/apply-geometry`, { data: { geometry: town, confirm: true } })).status()).toBe(409);
  });

  test("a rejected or merged candidate can't have geometry applied", async ({ request }) => {
    const w = await makeWorld(request);
    const { unitA, unitB } = await makeUnits(request, w);
    const c = await makeCandidate(request, w, unitA, unitB);
    await review(request, c.id, { action: "reject" });
    const res = await request.post(`/api/admin/territorial-change-candidates/${c.id}/apply-geometry`, { data: { geometry: square(-54, -26, -50, -22), confirm: true } });
    expect(res.status()).toBe(409);
    expect((await rows(request, w.conflictId)).length).toBe(1);
  });
});
