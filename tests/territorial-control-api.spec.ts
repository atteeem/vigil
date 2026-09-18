import { test, expect } from "@playwright/test";

// End-to-end coverage for Territorial Control Mode's data model and API —
// GET /api/territorial-control (public) and the /api/admin/territorial-control
// + /api/admin/actors CRUD/publish/supersede surface. Same request-fixture,
// unique()-suffixed, explicit-cleanup style as tests/world-timeline-api.spec.ts.

function unique() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

type APIRequestContext = import("@playwright/test").APIRequestContext;

async function createConflict(request: APIRequestContext) {
  const res = await request.post("/api/admin/conflicts", {
    data: {
      slug: `territorial-test-${unique()}`,
      name: `Territorial Test Conflict ${unique()}`,
      region: "Europe",
      severity: "guarded",
      intensity: 40,
    },
  });
  expect(res.ok()).toBe(true);
  return res.json();
}

async function createActor(request: APIRequestContext, conflictId: string, name = `Actor ${unique()}`) {
  const res = await request.post("/api/admin/actors", { data: { conflictId, name } });
  expect(res.ok()).toBe(true);
  return res.json();
}

const SQUARE_A = { type: "Polygon", coordinates: [[[10, 10], [11, 10], [11, 11], [10, 11], [10, 10]]] };
const SQUARE_B = { type: "Polygon", coordinates: [[[11, 10], [12, 10], [12, 11], [11, 11], [11, 10]]] };

async function createDraft(request: APIRequestContext, overrides: Record<string, unknown>) {
  const res = await request.post("/api/admin/territorial-control", {
    data: {
      status: "controlled",
      confidence: 0.75,
      geometry: SQUARE_A,
      // Well outside RECENTLY_CHANGED_WINDOW_MS (24h) by default — tests
      // that assert the ASSIGNED status (not the derived "recently
      // changed" display override, covered separately in
      // tests/territorial-control.spec.ts) shouldn't need to think about
      // that window unless they override validFrom themselves.
      validFrom: new Date(Date.now() - 48 * 3600_000).toISOString(),
      ...overrides,
    },
  });
  expect(res.ok()).toBe(true);
  return res.json();
}

async function publicListAt(request: APIRequestContext, at?: string) {
  const res = await request.get(at ? `/api/territorial-control?at=${encodeURIComponent(at)}` : "/api/territorial-control");
  expect(res.ok()).toBe(true);
  const collection = await res.json();
  return collection.features as { id: string; properties: Record<string, unknown> }[];
}

test("1. A draft territory is never returned by the public endpoint", async ({ request }) => {
  const conflict = await createConflict(request);
  const draft = await createDraft(request, { conflictId: conflict.id, validFrom: new Date(Date.now() - 60_000).toISOString() });

  const features = await publicListAt(request);
  expect(features.find((f) => f.id === draft.id)).toBeUndefined();

  await request.delete(`/api/admin/territorial-control/${draft.id}`);
  await request.delete(`/api/admin/conflicts/${conflict.id}`);
});

test("2. Publishing a draft makes it appear in the public 'as of now' list", async ({ request }) => {
  const conflict = await createConflict(request);
  const draft = await createDraft(request, { conflictId: conflict.id });

  let features = await publicListAt(request);
  expect(features.find((f) => f.id === draft.id)).toBeUndefined();

  const publishRes = await request.post(`/api/admin/territorial-control/${draft.id}/publish`);
  expect(publishRes.ok()).toBe(true);

  features = await publicListAt(request);
  const found = features.find((f) => f.id === draft.id);
  expect(found).toBeDefined();
  expect(found!.properties.status).toBe("controlled");

  await request.delete(`/api/admin/conflicts/${conflict.id}`);
});

test("3. A future validFrom is hidden from the current view but appears at or after that time", async ({ request }) => {
  const conflict = await createConflict(request);
  const futureStart = new Date(Date.now() + 3600_000).toISOString();
  const draft = await createDraft(request, { conflictId: conflict.id, validFrom: futureStart });
  await request.post(`/api/admin/territorial-control/${draft.id}/publish`);

  const now = await publicListAt(request);
  expect(now.find((f) => f.id === draft.id)).toBeUndefined();

  const afterStart = await publicListAt(request, new Date(Date.parse(futureStart) + 60_000).toISOString());
  expect(afterStart.find((f) => f.id === draft.id)).toBeDefined();

  await request.delete(`/api/admin/conflicts/${conflict.id}`);
});

test("4. Superseding a territory preserves the previous version's history rather than overwriting it", async ({ request }) => {
  const conflict = await createConflict(request);
  const actorA = await createActor(request, conflict.id, `Actor A ${unique()}`);
  const actorB = await createActor(request, conflict.id, `Actor B ${unique()}`);

  const changeTime = new Date();
  const before = new Date(changeTime.getTime() - 2 * 3600_000).toISOString();
  const after = new Date(changeTime.getTime() + 60_000).toISOString();

  const original = await createDraft(request, { conflictId: conflict.id, actorId: actorA.id, validFrom: before });
  await request.post(`/api/admin/territorial-control/${original.id}/publish`);

  const supersedeRes = await request.post(`/api/admin/territorial-control/${original.id}/supersede`, {
    data: { actorId: actorB.id, status: "controlled", confidence: 0.9, geometry: SQUARE_A, validFrom: changeTime.toISOString() },
  });
  expect(supersedeRes.ok()).toBe(true);
  const next = await supersedeRes.json();

  // Reconstructed BEFORE the change: actor A still controls it — the old
  // version's data was never mutated/lost, only closed out (validTo set).
  const beforeChange = await publicListAt(request, new Date(changeTime.getTime() - 60_000).toISOString());
  const beforeFeature = beforeChange.find((f) => f.id === original.id);
  expect(beforeFeature).toBeDefined();
  expect(beforeFeature!.properties.actorName).toBe(actorA.name);

  // Reconstructed AFTER the change: actor B controls it under the NEW
  // row id; the old row is gone from this view (superseded), not deleted.
  const afterChange = await publicListAt(request, after);
  expect(afterChange.find((f) => f.id === original.id)).toBeUndefined();
  const afterFeature = afterChange.find((f) => f.id === next.id);
  expect(afterFeature).toBeDefined();
  expect(afterFeature!.properties.actorName).toBe(actorB.name);

  // The admin listing still shows BOTH rows — nothing was destroyed.
  const adminRes = await request.get("/api/admin/territorial-control");
  const adminList = (await adminRes.json()) as { id: string; validTo: string | null }[];
  const originalAdminRow = adminList.find((t) => t.id === original.id);
  expect(originalAdminRow).toBeDefined();
  expect(originalAdminRow!.validTo).not.toBeNull();

  await request.delete(`/api/admin/conflicts/${conflict.id}`);
});

test("5. A published territory version cannot be edited or deleted — only superseded", async ({ request }) => {
  const conflict = await createConflict(request);
  const draft = await createDraft(request, { conflictId: conflict.id });
  await request.post(`/api/admin/territorial-control/${draft.id}/publish`);

  const patchRes = await request.patch(`/api/admin/territorial-control/${draft.id}`, { data: { confidence: 0.99 } });
  expect(patchRes.status()).toBe(409);

  const deleteRes = await request.delete(`/api/admin/territorial-control/${draft.id}`);
  expect(deleteRes.status()).toBe(409);

  await request.delete(`/api/admin/conflicts/${conflict.id}`);
});

test("6. A draft territory CAN be edited and deleted freely", async ({ request }) => {
  const conflict = await createConflict(request);
  const draft = await createDraft(request, { conflictId: conflict.id, status: "uncertain" });

  const patchRes = await request.patch(`/api/admin/territorial-control/${draft.id}`, { data: { status: "contested" } });
  expect(patchRes.ok()).toBe(true);
  expect((await patchRes.json()).status).toBe("contested");

  const deleteRes = await request.delete(`/api/admin/territorial-control/${draft.id}`);
  expect(deleteRes.ok()).toBe(true);

  await request.delete(`/api/admin/conflicts/${conflict.id}`);
});

test("7. Invalid geometry is rejected with 400, not silently accepted", async ({ request }) => {
  const conflict = await createConflict(request);
  const res = await request.post("/api/admin/territorial-control", {
    data: { conflictId: conflict.id, status: "controlled", confidence: 0.5, geometry: { type: "Point", coordinates: [0, 0] }, validFrom: new Date().toISOString() },
  });
  expect(res.status()).toBe(400);
  await request.delete(`/api/admin/conflicts/${conflict.id}`);
});

test("8. An invalid 'at' query value is rejected cleanly (400)", async ({ request }) => {
  const res = await request.get("/api/territorial-control?at=not-a-date");
  expect(res.status()).toBe(400);
});

test("9. Provenance (source name/URL) and confidence survive the full create -> publish -> reconstruct round trip", async ({ request }) => {
  const conflict = await createConflict(request);
  const draft = await createDraft(request, {
    conflictId: conflict.id,
    confidence: 0.42,
    sourceName: `Reuters test ${unique()}`,
    sourceUrl: "https://example.com/report",
    validFrom: new Date(Date.now() - 60_000).toISOString(),
  });
  await request.post(`/api/admin/territorial-control/${draft.id}/publish`);

  const features = await publicListAt(request);
  const found = features.find((f) => f.id === draft.id);
  expect(found!.properties.confidence).toBe(0.42);
  expect(found!.properties.sourceUrl).toBe("https://example.com/report");
  expect(String(found!.properties.sourceName)).toContain("Reuters test");

  await request.delete(`/api/admin/conflicts/${conflict.id}`);
});

test("10. Two actors in the same conflict get distinct, stable colors", async ({ request }) => {
  const conflict = await createConflict(request);
  const actorA = await createActor(request, conflict.id);
  const actorB = await createActor(request, conflict.id);
  expect(actorA.color).not.toBe(actorB.color);

  const listRes = await request.get(`/api/admin/actors?conflictId=${conflict.id}`);
  const list = await listRes.json();
  expect(list.find((a: { id: string }) => a.id === actorA.id).color).toBe(actorA.color);

  await request.delete(`/api/admin/conflicts/${conflict.id}`);
});

test("11. A contested/uncertain area with no clear actor is represented with actorId/actorName null", async ({ request }) => {
  const conflict = await createConflict(request);
  const draft = await createDraft(request, {
    conflictId: conflict.id,
    status: "contested",
  });
  await request.post(`/api/admin/territorial-control/${draft.id}/publish`);

  const features = await publicListAt(request);
  const found = features.find((f) => f.id === draft.id);
  expect(found!.properties.actorId).toBeNull();
  expect(found!.properties.actorName).toBeNull();
  expect(found!.properties.status).toBe("contested");

  await request.delete(`/api/admin/conflicts/${conflict.id}`);
});
