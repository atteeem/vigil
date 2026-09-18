import { test, expect } from "@playwright/test";

// End-to-end coverage for Event Version History's reconstruction API
// (spec "Event Version History / Timeline Backbone") — accepted-update
// history correctness, point-in-time reconstruction, source-attachment
// history, and the "known at T" historical query, exercised through the
// real dev server's API. Same request-fixture style as
// tests/event-update-proposals-api.spec.ts.

function unique() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function makeManualSource(request: import("@playwright/test").APIRequestContext) {
  const res = await request.post("/api/admin/sources", { data: { name: `Version History Source ${unique()}`, type: "manual" } });
  expect(res.ok()).toBe(true);
  return res.json();
}

async function makePublishedEvent(request: import("@playwright/test").APIRequestContext, overrides: Record<string, unknown> = {}) {
  const res = await request.post("/api/admin/events", {
    data: {
      title: `Airstrike hits Kyiv ${unique()}`,
      summary: "Independently written summary of the strike on Kyiv.",
      eventType: "airstrike",
      latitude: 50.45,
      longitude: 30.52,
      countryCode: "UA",
      region: "Europe",
      occurredAt: "2026-09-17T10:00:00.000Z",
      severity: "elevated",
      sourceName: `Version History Event Source ${unique()}`,
      ...overrides,
    },
  });
  expect(res.ok()).toBe(true);
  const event = await res.json();
  await request.post(`/api/admin/events/${event.id}/publish`);
  return event;
}

async function submitAndExtract(
  request: import("@playwright/test").APIRequestContext,
  sourceId: string,
  title: string,
  text: string,
) {
  const item = await request
    .post("/api/admin/incoming/manual", { data: { sourceId, externalId: unique(), originalTitle: title, originalText: text } })
    .then((r) => r.json());
  await request.post(`/api/admin/incoming/${item.id}/extract`);
  return item;
}

async function merge(request: import("@playwright/test").APIRequestContext, itemId: string, eventId: string) {
  const res = await request.post(`/api/admin/incoming/${itemId}/merge`, { data: { eventId } });
  expect(res.ok()).toBe(true);
  return res.json();
}

async function findPendingProposal(request: import("@playwright/test").APIRequestContext, eventId: string, field: string, itemId: string) {
  const { proposals } = await request.get(`/api/admin/events/${eventId}/proposals`).then((r) => r.json());
  const p = proposals.find((x: { field: string; status: string; rawIngestionItemId: string }) => x.field === field && x.status === "pending" && x.rawIngestionItemId === itemId);
  expect(p).toBeTruthy();
  return p;
}

test("1. Accepting two competing proposals out of order records the TRUE prior value each time, not a stale snapshot", async ({ request }) => {
  const event = await makePublishedEvent(request);
  const source = await makeManualSource(request);
  const itemA = await submitAndExtract(request, source.id, "Casualty report A", "Local officials said 5 people were killed.");
  const itemB = await submitAndExtract(request, source.id, "Casualty report B", "Hospital sources said 9 people were killed.");

  // Both proposals are created while event.casualtiesKilled is still
  // null, so both snapshot currentValue: null at creation time.
  await merge(request, itemA.id, event.id);
  await merge(request, itemB.id, event.id);
  const proposalA = await findPendingProposal(request, event.id, "casualtiesKilled", itemA.id);
  const proposalB = await findPendingProposal(request, event.id, "casualtiesKilled", itemB.id);
  expect(proposalA.currentValue).toBeNull();
  expect(proposalB.currentValue).toBeNull();
  expect(proposalA.proposedValue).not.toBe(proposalB.proposedValue);

  const acceptA = await request.patch(`/api/admin/events/${event.id}/proposals/${proposalA.id}`, { data: { action: "accept" } });
  expect(acceptA.ok()).toBe(true);
  // Captured AFTER the accept-A request has fully round-tripped (so it's
  // strictly later than both event.updatedAt and the history row's own
  // createdAt, which are set a couple ms apart from EACH OTHER within
  // that same transaction) but before accept-B is even sent.
  const midpoint = new Date();

  const acceptB = await request.patch(`/api/admin/events/${event.id}/proposals/${proposalB.id}`, { data: { action: "accept" } });
  expect(acceptB.ok()).toBe(true);

  const { history } = await request.get(`/api/admin/events/${event.id}/history`).then((r) => r.json());
  const killedEntries = history
    .filter((h: { field: string }) => h.field === "casualtiesKilled")
    .sort((a: { createdAt: string }, b: { createdAt: string }) => a.createdAt.localeCompare(b.createdAt));
  expect(killedEntries).toHaveLength(2);
  expect(killedEntries[0].oldValue).toBeNull();
  // The SECOND accepted entry's oldValue must be A's figure (the true
  // value right before it), not null (proposalB's stale creation-time
  // snapshot) — this is the exact bug the fix in acceptProposal guards.
  expect(killedEntries[1].oldValue).toBe(proposalA.proposedValue);

  // Reconstructing strictly between the two accepts must recover A's
  // figure, the value that genuinely existed at that moment.
  const reconstructed = await request
    .get(`/api/admin/events/${event.id}/reconstruct?at=${encodeURIComponent(midpoint.toISOString())}`)
    .then((r) => r.json());
  expect(String(reconstructed.casualtiesKilled)).toBe(proposalA.proposedValue);

  await request.delete(`/api/admin/events/${event.id}`);
});

test("2. Reconstructing before/after an accepted change recovers the old and new values respectively", async ({ request }) => {
  const event = await makePublishedEvent(request);
  const before = new Date().toISOString();
  const source = await makeManualSource(request);
  const item = await submitAndExtract(request, source.id, "Casualty report", "Officials said 7 people were killed in the strike.");
  await merge(request, item.id, event.id);
  const proposal = await findPendingProposal(request, event.id, "casualtiesKilled", item.id);
  await request.patch(`/api/admin/events/${event.id}/proposals/${proposal.id}`, { data: { action: "accept" } });
  const after = new Date().toISOString();

  const stateBefore = await request.get(`/api/admin/events/${event.id}/reconstruct?at=${encodeURIComponent(before)}`).then((r) => r.json());
  expect(stateBefore.casualtiesKilled).toBeNull();

  const stateAfter = await request.get(`/api/admin/events/${event.id}/reconstruct?at=${encodeURIComponent(after)}`).then((r) => r.json());
  expect(stateAfter.casualtiesKilled).toBe(7);

  await request.delete(`/api/admin/events/${event.id}`);
});

test("3. Source attachments are individually timestamped and reconstructable at a point in time", async ({ request }) => {
  const event = await makePublishedEvent(request);
  const initialSourceCountTime = new Date().toISOString();
  const source = await makeManualSource(request);
  const item = await submitAndExtract(request, source.id, "Corroborating report", "Local witnesses confirmed the strike.");
  await merge(request, item.id, event.id);
  const afterSecondAttachTime = new Date().toISOString();

  const detail = await request.get(`/api/admin/events/${event.id}`).then((r) => r.json());
  expect(detail.sources.length).toBe(2);
  expect(detail.sources.every((s: { attachedAt?: string }) => Boolean(s.attachedAt))).toBe(true);

  const early = await request
    .get(`/api/admin/events/${event.id}/reconstruct?at=${encodeURIComponent(initialSourceCountTime)}`)
    .then((r) => r.json());
  expect(early.sources.length).toBe(1);

  const late = await request
    .get(`/api/admin/events/${event.id}/reconstruct?at=${encodeURIComponent(afterSecondAttachTime)}`)
    .then((r) => r.json());
  expect(late.sources.length).toBe(2);

  await request.delete(`/api/admin/events/${event.id}`);
});

test("4. Rejecting a proposal creates no history entry and does not change current or reconstructed state", async ({ request }) => {
  const event = await makePublishedEvent(request, { severity: "elevated" });
  const source = await makeManualSource(request);
  const item = await submitAndExtract(request, source.id, "Escalation report", "Reports say the fighting escalated; 4 people were killed.");
  await merge(request, item.id, event.id);
  const proposal = await findPendingProposal(request, event.id, "severity", item.id);

  await request.patch(`/api/admin/events/${event.id}/proposals/${proposal.id}`, { data: { action: "reject" } });

  const { history } = await request.get(`/api/admin/events/${event.id}/history`).then((r) => r.json());
  expect(history.some((h: { field: string }) => h.field === "severity")).toBe(false);

  const now = await request.get(`/api/admin/events/${event.id}/reconstruct?at=${encodeURIComponent(new Date().toISOString())}`).then((r) => r.json());
  expect(now.severity).toBe("elevated");

  await request.delete(`/api/admin/events/${event.id}`);
});

test("5. An ordinary manual edit to one field never destroys existing history for a different field", async ({ request }) => {
  const event = await makePublishedEvent(request, { severity: "elevated" });
  const source = await makeManualSource(request);
  const item = await submitAndExtract(request, source.id, "Escalation report", "The situation escalated sharply; 6 people were killed.");
  await merge(request, item.id, event.id);
  const proposal = await findPendingProposal(request, event.id, "severity", item.id);
  await request.patch(`/api/admin/events/${event.id}/proposals/${proposal.id}`, { data: { action: "accept" } });

  const { history: beforeEdit } = await request.get(`/api/admin/events/${event.id}/history`).then((r) => r.json());
  expect(beforeEdit.length).toBeGreaterThan(0);

  const patchRes = await request.patch(`/api/admin/events/${event.id}`, { data: { summary: "A manually rewritten summary." } });
  expect(patchRes.ok()).toBe(true);

  const { history: afterEdit } = await request.get(`/api/admin/events/${event.id}/history`).then((r) => r.json());
  expect(afterEdit.length).toBe(beforeEdit.length);
  expect(afterEdit.some((h: { field: string; newValue: string }) => h.field === "severity" && h.newValue === "high")).toBe(true);

  await request.delete(`/api/admin/events/${event.id}`);
});

test("6. The known-at-T historical query only includes events that existed by that timestamp", async ({ request }) => {
  const beforeCreate = new Date().toISOString();
  const event = await makePublishedEvent(request);
  const afterCreate = new Date().toISOString();

  const early = await request.get(`/api/admin/events/known-at?at=${encodeURIComponent(beforeCreate)}`).then((r) => r.json());
  expect(early.events.some((e: { id: string }) => e.id === event.id)).toBe(false);

  const late = await request.get(`/api/admin/events/known-at?at=${encodeURIComponent(afterCreate)}`).then((r) => r.json());
  expect(late.events.some((e: { id: string }) => e.id === event.id)).toBe(true);

  await request.delete(`/api/admin/events/${event.id}`);
});

test("7. Reconstructing a timestamp before the event was created returns 404", async ({ request }) => {
  const event = await makePublishedEvent(request);
  const res = await request.get(`/api/admin/events/${event.id}/reconstruct?at=2020-01-01T00:00:00.000Z`);
  expect(res.status()).toBe(404);
  await request.delete(`/api/admin/events/${event.id}`);
});
