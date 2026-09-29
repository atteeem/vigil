import { test, expect, type APIRequestContext } from "@playwright/test";
import { detectTerritorialChangeMentions, canonicalActorName, claimKeyFor } from "@/lib/territory/change-detection";
import { resolveLocationPrecision } from "@/lib/territory/location-precision";
import { eventsToGeoJSON } from "@/lib/map/events-to-geojson";
import type { ConflictEvent } from "@/lib/types";

// Territorial Change Intelligence. Detection/precision are pure unit tests;
// the workflow tests use a dedicated conflict per test (unique names) so the
// Desktop and Mobile projects never collide on the shared DB.

const MM = { countryCode: "MM" };
const detect = (text: string, ctx: { countryCode?: string } = MM) => detectTerritorialChangeMentions(text, ctx);

test.describe("Central phrase normalization (lib/territory/change-detection.ts)", () => {
  test("captured / seized / took control of all normalize to 'captured'", () => {
    for (const text of [
      "Rebel forces captured Kyaukme after heavy fighting.",
      "The Arakan Army seized Paletwa after heavy fighting.",
      "The Arakan Army seized control of Paletwa after heavy fighting.",
      "The Arakan Army took control of Paletwa after heavy fighting.",
    ]) {
      expect(detect(text)[0]?.changeType, text).toBe("captured");
    }
  });

  test("recaptured / retook normalize to 'recaptured'; 'regained control' to 'control_restored'", () => {
    expect(detect("The Tatmadaw recaptured Moebye from KNDF during fighting.")[0]).toMatchObject({ changeType: "recaptured", claimedActorName: "Tatmadaw", previousActorName: "KNDF", locationName: "Moebye" });
    expect(detect("The Tatmadaw retook Demoso from KNDF after an offensive.")[0]?.changeType).toBe("recaptured");
    expect(detect("The Arakan Army regained control of Paletwa from the Tatmadaw in fighting.")[0]?.changeType).toBe("control_restored");
  });

  test("'X lost Y' / 'lost control of Y to Z' records the loser as previous and the taker as claimed", () => {
    expect(detect("The Tatmadaw lost Buthidaung to the Arakan Army in heavy fighting.")[0]).toMatchObject({
      changeType: "lost_control",
      previousActorName: "Tatmadaw",
      claimedActorName: "Arakan Army",
      locationName: "Buthidaung",
    });
  });

  test("withdrawal, handover, contested and uncertain phrasing", () => {
    expect(detect("The Tatmadaw withdrew from Buthidaung amid clashes.")[0]).toMatchObject({ changeType: "withdrawn", previousActorName: "Tatmadaw", claimedActorName: null });
    expect(detect("MNDAA handed Lashio to the Tatmadaw under the deal, after weeks of fighting.")[0]).toMatchObject({ changeType: "transferred", previousActorName: "MNDAA", claimedActorName: "Tatmadaw" });
    expect(detect("Kyaukme became contested after clashes between the army and rebels.")[0]?.changeType).toBe("contested");
    expect(detect("Fighting for control of Kyaukphyu continues between rival forces.")[0]).toMatchObject({ changeType: "contested", locationName: "Kyaukphyu" });
    expect(detect("Control of Hpakant is unclear after fighting between armed groups.")[0]?.changeType).toBe("control_uncertain");
  });

  test("passive phrasing yields the same claim", () => {
    expect(detect("Kyaukme was captured by the Arakan Army in fighting.")[0]).toMatchObject({ changeType: "captured", claimedActorName: "Arakan Army", locationName: "Kyaukme" });
  });

  test("false positives: metaphor, accidents, sport and business never produce a mention", () => {
    for (const text of [
      "The film captured the imagination of viewers.",
      "Fighters seized the opportunity to advance their message.",
      "The pilot lost control of the aircraft during training.",
      "Chelsea lost Arsenal in the league.",
      "Apple took control of Netflix in the streaming market.",
      "Investors captured Market gains in the fighting for shares.",
    ]) {
      expect(detect(text), text).toHaveLength(0);
    }
  });

  test("a headline plus its body sentence collapse to one, richest, claim", () => {
    const mentions = detect("Junta retakes Kyaukme from resistance forces\nThe Tatmadaw recaptured Kyaukme from KNDF after several days of fighting.");
    expect(mentions).toHaveLength(1);
    expect(mentions[0]).toMatchObject({ claimedActorName: "Tatmadaw", previousActorName: "KNDF" });
  });

  test("actor deduplication: junta / SAC / Tatmadaw and 'KNLA fighters' resolve to one canonical actor; 'junta' is only Tatmadaw in Myanmar", () => {
    for (const raw of ["the junta", "Tatmadaw", "SAC", "military junta", "Myanmar military"]) expect(canonicalActorName(raw, MM)).toBe("Tatmadaw");
    expect(canonicalActorName("KNLA fighters", MM)).toBe("KNLA");
    expect(canonicalActorName("resistance forces", MM)).toBeNull();
    expect(canonicalActorName("the junta", {})).toBeNull();
    expect(canonicalActorName("Russian forces", {})).toBe("Russia");
  });

  test("claim identity ignores previous actor and casing; different claimed actors are different claims", () => {
    const a = claimKeyFor({ conflictId: "c", locationName: "Paletwa", changeType: "captured", claimedActorName: "Arakan Army" });
    expect(claimKeyFor({ conflictId: "c", locationName: " paletwa ", changeType: "captured", claimedActorName: "arakan army" })).toBe(a);
    expect(claimKeyFor({ conflictId: "c", locationName: "Paletwa", changeType: "captured", claimedActorName: "Tatmadaw" })).not.toBe(a);
  });
});

test.describe("Location precision", () => {
  test("a gazetteer place is approximate with a point; an admin-area suffix is area-level; anything else is unknown — and only approximate gets coordinates", () => {
    const yangon = resolveLocationPrecision("Yangon");
    expect(yangon.precision).toBe("approximate");
    expect(yangon.lat).not.toBeNull();
    expect(resolveLocationPrecision("Yangon", "region")).toEqual({ precision: "area_level", lat: null, lng: null });
    expect(resolveLocationPrecision("Kyaukme")).toEqual({ precision: "unknown", lat: null, lng: null });
  });

  test("detected mentions keep the administrative suffix so area-level claims stay area-level", () => {
    const [m] = detect("KNLA fighters took control of Myawaddy township after fighting.");
    expect(m).toMatchObject({ locationName: "Myawaddy", locationSuffix: "township" });
    expect(resolveLocationPrecision(m!.locationName, m!.locationSuffix).precision).toBe("area_level");
  });

  test("map GeoJSON carries the event's precision so the map can draw an uncertainty halo", () => {
    const base = { id: "e", slug: "e", title: "t", eventType: "airstrike", severity: "high", importance: 50, lat: 1, lng: 2 } as unknown as ConflictEvent;
    const [f] = eventsToGeoJSON([{ ...base, locationPrecision: "area_level" }]).features;
    expect(f!.properties.precision).toBe("area_level");
    expect(eventsToGeoJSON([base]).features[0]!.properties.precision).toBe("");
  });
});

test.describe.serial("Detection through ingestion (Myanmar source)", () => {
  let sourceA: string;

  async function ingest(request: APIRequestContext, feed: string) {
    const source = await request
      .post("/api/admin/sources", {
        data: {
          name: `Territorial ${feed} ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          type: "rss",
          url: `http://localhost:3100/api/test-fixtures/rss/${feed}`,
          country: "MM",
          language: "en",
          sourceCategory: "News",
          sourceRole: "local_media",
          reliabilityTier: "B",
          enabled: true,
          autoIngest: false,
          autoProcessing: true,
        },
      })
      .then((r) => r.json());
    const fetched = await request.post(`/api/admin/sources/${source.id}/fetch`).then((r) => r.json());
    expect(fetched.errors).toBe(0);
    return source.id as string;
  }

  const listAll = (request: APIRequestContext) => request.get("/api/admin/territorial-change-candidates").then((r) => r.json()) as Promise<Record<string, any>[]>;
  const at = (all: Record<string, any>[], place: string, type?: string) => all.filter((c) => c.locationName === place && (!type || c.changeType === type));

  test("1. Sourced reports become structured candidates and never touch territory", async ({ request }) => {
    const before = (await request.get("/api/admin/territorial-control").then((r) => r.json())).length;
    sourceA = await ingest(request, "territorial-change-feed");
    const all = await listAll(request);

    const captured = at(all, "Paletwa", "captured").filter((c) => c.claimedActorName === "Arakan Army");
    expect(captured).toHaveLength(1);
    expect(captured[0]!).toMatchObject({ previousActorName: "Tatmadaw", precision: "unknown", lat: null, lng: null });
    expect(captured[0]!.evidence).toContain("rule:captured");
    expect(captured[0]!.sourceUrl).toBe("https://fixture.test/territorial/paletwa-captured");
    expect(captured[0]!.confidence).toBeGreaterThan(0);
    expect(captured[0]!.confidence).toBeLessThanOrEqual(0.7);

    expect(at(all, "Buthidaung", "withdrawn")[0]!).toMatchObject({ previousActorName: "Tatmadaw", claimedActorName: null });
    expect(at(all, "Kyaukphyu", "contested")).toHaveLength(1);

    const territories = await request.get("/api/admin/territorial-control").then((r) => r.json());
    expect(territories).toHaveLength(before);
  });

  test("2. Area-level wording stays area-level with no invented coordinates; hedging lowers confidence; actor variants are deduplicated", async ({ request }) => {
    const all = await listAll(request);
    const myawaddy = at(all, "Myawaddy", "captured")[0]!;
    expect(myawaddy).toMatchObject({ precision: "area_level", lat: null, lng: null, claimedActorName: "KNLA" });
    const paletwa = at(all, "Paletwa", "captured").find((c) => c.claimedActorName === "Arakan Army");
    expect(myawaddy.confidence).toBeLessThan(paletwa!.confidence);
    const units = await request.get("/api/admin/military-units").then((r) => r.json());
    expect(units.filter((u: { name: string }) => u.name === "KNLA")).toHaveLength(1);
    expect(units.filter((u: { name: string }) => u.name === "Tatmadaw")).toHaveLength(1);
    expect(units.some((u: { name: string }) => /fighters/i.test(u.name))).toBe(false);
  });

  test("3. Non-territorial sentences produce no candidates", async ({ request }) => {
    const all = await listAll(request);
    expect(all.filter((c) => /imagination|opportunity|aircraft/i.test(c.description))).toHaveLength(0);
  });

  test("4. A restatement from another source is folded in as corroboration; a different claimed controller coexists and both are flagged as conflicting", async ({ request }) => {
    await ingest(request, "territorial-change-feed-b");
    const all = await listAll(request);
    const arakan = at(all, "Paletwa", "captured").filter((c) => c.claimedActorName === "Arakan Army");
    expect(arakan).toHaveLength(1);
    expect(arakan[0]!.corroboration.length).toBeGreaterThanOrEqual(1);
    // Corroboration nudges confidence but never to certainty, and never above the cap.
    expect(arakan[0]!.confidence).toBeLessThanOrEqual(0.8);

    const tatmadaw = at(all, "Paletwa", "captured").filter((c) => c.claimedActorName === "Tatmadaw");
    expect(tatmadaw).toHaveLength(1);
    expect(["pending", "uncertain"]).toContain(arakan[0]!.status);
    expect(arakan[0]!.comparison.outcome).toBe("conflicting_claim");
    expect(tatmadaw[0]!.comparison.outcome).toBe("conflicting_claim");
    expect(arakan[0]!.comparison.conflictingCandidateIds).toContain(tatmadaw[0]!.id);
  });

  test("5. Re-polling never duplicates a claim", async ({ request }) => {
    const before = (await listAll(request)).length;
    await ingest(request, "territorial-change-feed");
    await ingest(request, "territorial-change-feed-b");
    expect((await listAll(request)).length).toBe(before);
  });

  test("6. Myanmar seed data: approximate and unknown precision are preserved and Areas of Operation stay out of territorial control", async ({ request }) => {
    const all = await listAll(request);
    const lashio = at(all, "Lashio")[0]!;
    const moebye = at(all, "Moebye")[0]!;
    expect(lashio).toMatchObject({ precision: "approximate", changeType: "transferred", claimedActorName: "Tatmadaw", previousActorName: "MNDAA" });
    expect(lashio.lat).not.toBeNull();
    expect(moebye).toMatchObject({ precision: "unknown", changeType: "recaptured", lat: null, lng: null });
    // No Myanmar territory exists to compare against -> insufficient evidence, never a guess.
    expect(moebye.comparison.outcome).toBe("insufficient_evidence");
    expect(moebye.comparison.currentStatus).toBeNull();

    const areas = await request.get("/api/admin/areas-of-operation").then((r) => r.json());
    expect(areas.length).toBeGreaterThan(0);
    const territories = await request.get("/api/admin/territorial-control").then((r) => r.json());
    for (const area of areas) expect(territories.some((t: { id: string }) => t.id === area.id)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Review workflow against a dedicated conflict per test.

const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const SQUARE = { type: "Polygon", coordinates: [[[10, 10], [11, 10], [11, 11], [10, 11], [10, 10]]] };
const OTHER_SQUARE = { type: "Polygon", coordinates: [[[20, 20], [21, 20], [21, 21], [20, 21], [20, 20]]] };

interface World {
  conflictId: string;
  a: { id: string; name: string };
  b: { id: string; name: string };
  unitA: { id: string; name: string };
  unitB: { id: string; name: string };
  territoryId: string;
}

async function makeWorld(request: APIRequestContext): Promise<World> {
  const conflict = await request
    .post("/api/admin/conflicts", { data: { slug: `tc-${unique()}`, name: `TC Conflict ${unique()}`, region: "Asia", severity: "guarded", intensity: 40 } })
    .then((r) => r.json());
  const tag = unique();
  const nameA = `Alpha ${tag}`;
  const nameB = `Bravo ${tag}`;
  const a = await request.post("/api/admin/actors", { data: { conflictId: conflict.id, name: nameA } }).then((r) => r.json());
  const b = await request.post("/api/admin/actors", { data: { conflictId: conflict.id, name: nameB } }).then((r) => r.json());
  const unitA = await request.post("/api/admin/military-units", { data: { name: nameA } }).then((r) => r.json());
  const unitB = await request.post("/api/admin/military-units", { data: { name: nameB } }).then((r) => r.json());
  const draft = await request
    .post("/api/admin/territorial-control", {
      data: {
        conflictId: conflict.id,
        actorId: a.id,
        status: "controlled",
        confidence: 0.8,
        geometry: SQUARE,
        sourceName: "Original mapper",
        validFrom: new Date(Date.now() - 72 * 3600_000).toISOString(),
      },
    })
    .then((r) => r.json());
  await request.post(`/api/admin/territorial-control/${draft.id}/publish`);
  return { conflictId: conflict.id, a, b, unitA, unitB, territoryId: draft.id };
}

async function makeCandidate(request: APIRequestContext, w: World, overrides: Record<string, unknown> = {}) {
  const res = await request.post("/api/admin/territorial-change-candidates", {
    data: {
      conflictId: w.conflictId,
      description: "Test report of a change of control",
      changeType: "captured",
      claimedActorId: w.unitB.id,
      previousActorId: w.unitA.id,
      locationName: `Town ${unique()}`,
      lat: 10.5,
      lng: 10.5,
      precision: "approximate",
      sourceName: "Fixture Wire",
      sourceUrl: `https://fixture.test/tc/${unique()}`,
      observedAt: new Date(Date.now() - 3600_000).toISOString(),
      ...overrides,
    },
  });
  expect(res.status()).toBe(201);
  const created = await res.json();
  return getCandidate(request, created.id);
}

async function getCandidate(request: APIRequestContext, id: string) {
  const all = (await request.get("/api/admin/territorial-change-candidates").then((r) => r.json())) as Record<string, any>[];
  return all.find((c) => c.id === id)!;
}

const review = (request: APIRequestContext, id: string, data: Record<string, unknown>) =>
  request.post(`/api/admin/territorial-change-candidates/${id}/review`, { data });

async function territoriesFor(request: APIRequestContext, conflictId: string) {
  const all = (await request.get("/api/admin/territorial-control").then((r) => r.json())) as Record<string, any>[];
  return all.filter((t) => t.conflictId === conflictId);
}

async function publicAt(request: APIRequestContext, at: Date, conflictId: string) {
  // The route ships geometry only for datasets the caller explicitly asks for (never every territory on
  // Earth by default) — "conflict:<id>" is the editorially-drawn-territory dataset id for one conflict.
  const collection = await request.get(`/api/territorial-control?at=${encodeURIComponent(at.toISOString())}&datasets=conflict:${conflictId}`).then((r) => r.json());
  return collection.features as { id: string; properties: Record<string, any> }[];
}

test.describe("Territorial change review workflow", () => {
  test("current-vs-proposed comparison reads the versioned territory at the reported point", async ({ request }) => {
    const w = await makeWorld(request);
    const c = await makeCandidate(request, w);
    expect(c.comparison).toMatchObject({
      outcome: "genuine_change",
      currentActorName: w.a.name,
      currentStatus: "controlled",
      proposedActorName: w.b.name,
      proposedStatus: "controlled",
      canReuseGeometry: true,
      currentTerritoryId: w.territoryId,
    });
    expect(c.status).toBe("pending");
  });

  test("approval supersedes the versioned territory: old row closed, new row opened, provenance kept, history playable", async ({ request }) => {
    const w = await makeWorld(request);
    const c = await makeCandidate(request, w, { sourceName: "Fixture Wire", sourceUrl: "https://fixture.test/tc/provenance" });
    const changeAt = new Date(c.observedAt);

    const res = await review(request, c.id, { action: "approve", note: "verified" });
    expect(res.ok()).toBe(true);
    const approved = await res.json();
    expect(approved).toMatchObject({ status: "approved", geometryPending: false, reviewNote: "verified" });
    expect(approved.appliedTerritoryId).toBeTruthy();

    const rows = await territoriesFor(request, w.conflictId);
    expect(rows).toHaveLength(2); // nothing was overwritten or deleted
    const old = rows.find((t) => t.id === w.territoryId)!;
    const created = rows.find((t) => t.id === approved.appliedTerritoryId)!;
    expect(new Date(old.validTo).toISOString()).toBe(new Date(created.validFrom).toISOString());
    expect(new Date(created.validFrom).getTime()).toBeCloseTo(changeAt.getTime(), -3);
    expect(old.actorName).toBe(w.a.name); // old state still says what it said
    expect(created).toMatchObject({ actorName: w.b.name, status: "controlled", published: true, sourceName: "Fixture Wire", sourceUrl: "https://fixture.test/tc/provenance", validTo: null });
    expect(created.geometry).toEqual(old.geometry); // reused, not invented

    // Historical playback: before the change A holds it, after the change B does.
    const before = await publicAt(request, new Date(changeAt.getTime() - 60_000), w.conflictId);
    expect(before.find((f) => f.id === w.territoryId)?.properties.actorName).toBe(w.a.name);
    expect(before.find((f) => f.id === created.id)).toBeUndefined();
    const after = await publicAt(request, new Date(), w.conflictId);
    expect(after.find((f) => f.id === created.id)?.properties.actorName).toBe(w.b.name);
    expect(after.find((f) => f.id === w.territoryId)).toBeUndefined();

    // Approval is single-shot.
    expect((await review(request, c.id, { action: "approve" })).status()).toBe(409);
  });

  test("rejection changes nothing", async ({ request }) => {
    const w = await makeWorld(request);
    const c = await makeCandidate(request, w);
    const before = await territoriesFor(request, w.conflictId);
    const res = await review(request, c.id, { action: "reject", note: "unreliable" });
    expect((await res.json()).status).toBe("rejected");
    expect(await territoriesFor(request, w.conflictId)).toEqual(before);
  });

  test("'mark uncertain' keeps the candidate open, changes nothing, and can still be approved later", async ({ request }) => {
    const w = await makeWorld(request);
    const c = await makeCandidate(request, w);
    const before = await territoriesFor(request, w.conflictId);
    expect((await (await review(request, c.id, { action: "uncertain" })).json()).status).toBe("uncertain");
    expect(await territoriesFor(request, w.conflictId)).toEqual(before);
    expect((await review(request, c.id, { action: "approve" })).ok()).toBe(true);
  });

  test("without geometry, approval is a verified record pending geometry — no polygon is fabricated — until an admin supplies one", async ({ request }) => {
    const w = await makeWorld(request);
    const c = await makeCandidate(request, w, { precision: "unknown", lat: 10.5, lng: 10.5 }); // lat/lng must be dropped for unknown
    expect(c.lat).toBeNull();
    expect(c.comparison.outcome).toBe("insufficient_evidence");
    expect(c.comparison.canReuseGeometry).toBe(false);

    const before = await territoriesFor(request, w.conflictId);
    const approved = await (await review(request, c.id, { action: "approve" })).json();
    expect(approved).toMatchObject({ status: "approved", geometryPending: true, appliedTerritoryId: null });
    expect(await territoriesFor(request, w.conflictId)).toEqual(before);

    const bad = await request.post(`/api/admin/territorial-change-candidates/${c.id}/geometry`, { data: { geometry: { type: "Point", coordinates: [1, 1] } } });
    expect(bad.status()).toBe(409);

    const done = await request.post(`/api/admin/territorial-change-candidates/${c.id}/geometry`, { data: { geometry: OTHER_SQUARE } });
    expect(done.ok()).toBe(true);
    const finished = await done.json();
    expect(finished).toMatchObject({ geometryPending: false });
    const rows = await territoriesFor(request, w.conflictId);
    const created = rows.find((t) => t.id === finished.appliedTerritoryId)!;
    expect(created).toMatchObject({ actorName: w.b.name, published: true, geometry: OTHER_SQUARE });
  });

  test("a claim the map already reflects is 'already known'", async ({ request }) => {
    const w = await makeWorld(request);
    const c = await makeCandidate(request, w, { claimedActorId: w.unitA.id, previousActorId: null });
    expect(c.comparison.outcome).toBe("already_known");
  });

  test("a report contradicting the map's current controller is a conflicting claim and cannot silently reuse geometry", async ({ request }) => {
    const w = await makeWorld(request);
    // Report says B lost it to A's rival... but the map shows A in control, and previous=B.
    const c = await makeCandidate(request, w, { claimedActorId: w.unitA.id, previousActorId: w.unitB.id });
    expect(c.comparison.outcome).toBe("conflicting_claim");
    expect(c.comparison.canReuseGeometry).toBe(false);
    expect((await review(request, c.id, { action: "approve", geometryMode: "reuse" })).status()).toBe(409);
    const approved = await (await review(request, c.id, { action: "approve" })).json();
    expect(approved.geometryPending).toBe(true);
  });

  test("withdrawal or lost control with no claimant proposes 'uncertain' with no controller", async ({ request }) => {
    const w = await makeWorld(request);
    const c = await makeCandidate(request, w, { changeType: "withdrawn", claimedActorId: null, previousActorId: w.unitA.id });
    expect(c.comparison).toMatchObject({ proposedStatus: "uncertain", proposedActorName: null, outcome: "genuine_change" });
    const approved = await (await review(request, c.id, { action: "approve" })).json();
    const created = (await territoriesFor(request, w.conflictId)).find((t) => t.id === approved.appliedTerritoryId)!;
    expect(created).toMatchObject({ status: "uncertain", actorId: null });
  });

  test("contested claims coexist with each other and merge folds one into the other", async ({ request }) => {
    const w = await makeWorld(request);
    const place = `Shared ${unique()}`;
    const x = await makeCandidate(request, w, { locationName: place, claimedActorId: w.unitB.id, precision: "unknown" });
    const y = await makeCandidate(request, w, { locationName: place, claimedActorId: w.unitA.id, previousActorId: w.unitB.id, precision: "unknown", sourceName: "Second Wire" });
    expect((await getCandidate(request, x.id)).comparison.outcome).toBe("conflicting_claim");
    expect((await getCandidate(request, y.id)).comparison.outcome).toBe("conflicting_claim");
    expect((await getCandidate(request, x.id)).status).toBe("pending");
    expect((await getCandidate(request, y.id)).status).toBe("pending");

    const merged = await (await review(request, y.id, { action: "merge", mergeIntoId: x.id })).json();
    expect(merged).toMatchObject({ status: "merged", mergedIntoId: x.id });
    const target = await getCandidate(request, x.id);
    expect(target.corroboration.map((c: { sourceName: string }) => c.sourceName)).toContain("Second Wire");
    expect(target.confidence).toBeGreaterThan(x.confidence);
    expect(target.confidence).toBeLessThanOrEqual(0.8);
    expect((await review(request, y.id, { action: "merge", mergeIntoId: x.id })).status()).toBe(409);
  });

  test("candidates from different conflicts can't be merged; unknown actions and ids are rejected", async ({ request }) => {
    const w1 = await makeWorld(request);
    const w2 = await makeWorld(request);
    const c1 = await makeCandidate(request, w1);
    const c2 = await makeCandidate(request, w2);
    expect((await review(request, c1.id, { action: "merge", mergeIntoId: c2.id })).status()).toBe(409);
    expect((await review(request, c1.id, { action: "publish" })).status()).toBe(400);
    expect((await review(request, "does-not-exist", { action: "reject" })).status()).toBe(404);
  });

  test("an Area of Operation never counts as territorial control when comparing", async ({ request }) => {
    const w = await makeWorld(request);
    const aoo = await request.post("/api/admin/areas-of-operation", {
      data: { unitId: w.unitB.id, conflictId: w.conflictId, name: "AOO", geometry: OTHER_SQUARE, precision: "area_level" },
    });
    expect(aoo.ok()).toBe(true);
    // A point inside the AOO but in no Territorial Control polygon -> no current state.
    const c = await makeCandidate(request, w, { lat: 20.5, lng: 20.5 });
    expect(c.comparison).toMatchObject({ outcome: "insufficient_evidence", currentStatus: null });
    await review(request, c.id, { action: "approve" });
    expect((await territoriesFor(request, w.conflictId)).filter((t) => t.geometry.coordinates?.[0]?.[0]?.[0] === 20)).toHaveLength(0);
  });

  test("scoring stays separate: conflict severity is untouched by candidates, corroboration and approvals", async ({ request }) => {
    const w = await makeWorld(request);
    const readConflict = async () => {
      const list = (await request.get("/api/admin/conflicts").then((r) => r.json())) as Record<string, any>[];
      const conflict = list.find((c) => c.id === w.conflictId)!;
      return { severity: conflict.severity, intensity: conflict.intensity };
    };
    const before = await readConflict();
    const c = await makeCandidate(request, w);
    await makeCandidate(request, w, { sourceName: "Another wire" });
    await review(request, c.id, { action: "approve" });
    expect(await readConflict()).toEqual(before);
  });
});

test.describe("Event location precision", () => {
  test("a manually created event records its precision and the public API exposes it", async ({ request }) => {
    const res = await request.post("/api/admin/events", {
      data: {
        title: `Precision test ${unique()}`,
        summary: "Shelling reported in the wider area.",
        eventType: "artillery",
        latitude: 16.8,
        longitude: 96.1,
        locationPrecision: "area_level",
        occurredAt: new Date().toISOString(),
        severity: "elevated",
        published: true,
        sourceName: "Precision Fixture",
      },
    });
    expect(res.status()).toBe(201);
    const event = await res.json();
    expect(event.locationPrecision).toBe("area_level");
    const events = (await request.get("/api/events").then((r) => r.json())) as { id: string; locationPrecision?: string | null }[];
    expect(events.find((e) => e.id === event.id)?.locationPrecision).toBe("area_level");
    const invalid = await request.post("/api/admin/events", { data: { title: "x", summary: "y", eventType: "artillery", latitude: 1, longitude: 1, locationPrecision: "pinpoint", occurredAt: new Date().toISOString(), severity: "elevated", sourceName: "s" } });
    expect(invalid.status()).toBe(400);
  });
});

test.describe("Territorial Changes admin page", () => {
  test.use({ isMobile: false });

  test("shows source, precision, current and proposed state, and requires explicit confirmation before Approve applies", async ({ page, request }) => {
    const w = await makeWorld(request);
    const c = await makeCandidate(request, w, { description: "Alpha lost the town to Bravo, per fixture wire" });

    await page.goto("/admin/territorial-changes");
    await expect(page.getByTestId("territorial-changes-page")).toBeVisible();
    await page.getByTestId("tc-row").filter({ hasText: c.locationName }).click();

    const detail = page.getByTestId("tc-detail");
    await expect(detail).toContainText("Alpha lost the town to Bravo");
    await expect(page.getByTestId("tc-precision")).toHaveText("Approximate");
    await expect(page.getByTestId("tc-outcome")).toHaveText("Genuine change");
    await expect(page.getByTestId("tc-current")).toContainText(w.a.name);
    await expect(page.getByTestId("tc-proposed")).toContainText(w.b.name);
    await expect(detail).toContainText("Fixture Wire");

    // Approval must be explicit.
    await expect(page.getByTestId("tc-approve")).toBeDisabled();
    await page.getByTestId("tc-confirm").check();
    await page.getByTestId("tc-approve").click();
    await expect(page.getByTestId("tc-tab-resolved")).toBeVisible();
    await expect.poll(async () => (await getCandidate(request, c.id)).status).toBe("approved");
    expect((await territoriesFor(request, w.conflictId)).filter((t) => t.validTo === null && t.actorName === w.b.name)).toHaveLength(1);
  });

  test("a candidate awaiting geometry is surfaced in its own tab", async ({ page, request }) => {
    const w = await makeWorld(request);
    const c = await makeCandidate(request, w, { precision: "unknown" });
    await review(request, c.id, { action: "approve" });
    await page.goto("/admin/territorial-changes");
    await page.getByTestId("tc-tab-geometry").click();
    await expect(page.getByTestId("tc-row").filter({ hasText: c.locationName })).toBeVisible();
  });
});

test.describe("Map uncertainty for approximate locations", () => {
  test.use({ isMobile: false });

  test("an area-level event feeds the uncertainty-halo layer with its precision, so it isn't drawn like an exact pin", async ({ page, request }) => {
    const title = `Halo test ${unique()}`;
    const created = await request.post("/api/admin/events", {
      data: { title, summary: "Area-level report.", eventType: "artillery", latitude: 16.8, longitude: 96.1, locationPrecision: "area_level", occurredAt: new Date().toISOString(), severity: "elevated", published: true, sourceName: "Halo Fixture" },
    });
    expect(created.status()).toBe(201);

    await page.goto("/world");
    await page.waitForFunction(() => Boolean((window as unknown as { __vigilMap?: unknown }).__vigilMap));
    await expect
      .poll(async () =>
        page.evaluate((t) => {
          const map = (window as unknown as { __vigilMap: { getLayer: (id: string) => unknown; jumpTo: (o: unknown) => void; querySourceFeatures: (s: string) => { properties: Record<string, unknown> }[] } }).__vigilMap;
          if (!map.getLayer("unclustered-point-uncertainty")) return "no-layer";
          map.jumpTo({ center: [96.1, 16.8], zoom: 10 }); // zoomed in so the event isn't inside a cluster
          const hit = map.querySourceFeatures("events").find((f) => f.properties.title === t);
          return hit ? String(hit.properties.precision) : "not-loaded";
        }, title),
      )
      .toBe("area_level");
  });
});

// This file publishes territory polygons and events into the shared dev DB;
// leaving them behind overlaps other specs' map-click fixtures, so remove
// everything it created (dedicated conflicts cascade to their territories,
// actors and candidates).
test.afterAll(async () => {
  const { prisma } = await import("@/lib/db/client");
  await prisma.conflict.deleteMany({ where: { slug: { startsWith: "tc-" } } });
  await prisma.event.deleteMany({ where: { OR: [{ title: { startsWith: "Halo test" } }, { title: { startsWith: "Precision test" } }] } });
});
