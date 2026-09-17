import { test, expect } from "@playwright/test";

// End-to-end coverage for the Live Event Updates admin API (spec "Live
// Event Updates") — matching/attaching, proposal generation, approval,
// and history, exercised through the real dev server's API. Same
// request-fixture style as tests/extract-facts-api.spec.ts.

function unique() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function makeManualSource(request: import("@playwright/test").APIRequestContext) {
  const res = await request.post("/api/admin/sources", { data: { name: `Live Updates Source ${unique()}`, type: "manual" } });
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
      sourceName: `Live Updates Event Source ${unique()}`,
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

test("1. A matching report attaches to the existing event and its facts generate pending update proposals", async ({ request }) => {
  const beforeEvents = await request.get("/api/admin/events").then((r) => r.json());
  const event = await makePublishedEvent(request, { severity: "elevated" });
  const source = await makeManualSource(request);
  const item = await submitAndExtract(
    request,
    source.id,
    "Airstrike hits Kyiv again",
    "A fresh airstrike struck Kyiv again overnight; 12 people were killed. Israeli forces were blamed.",
  );

  const mergeResult = await merge(request, item.id, event.id);
  expect(mergeResult.proposalsCreated).toBeGreaterThan(0);

  const { proposals } = await request.get(`/api/admin/events/${event.id}/proposals`).then((r) => r.json());
  const pending = proposals.filter((p: { status: string }) => p.status === "pending");
  expect(pending.length).toBeGreaterThan(0);
  const severityProposal = pending.find((p: { field: string }) => p.field === "severity");
  expect(severityProposal.currentValue).toBe("elevated");
  expect(severityProposal.proposedValue).toBe("high");
  expect(severityProposal.rawIngestionItemId).toBe(item.id);

  // No duplicate public event was created by matching/attaching.
  const afterEvents = await request.get("/api/admin/events").then((r) => r.json());
  expect(afterEvents.length).toBe(beforeEvents.length + 1); // +1 for the one event this test itself created

  await request.delete(`/api/admin/events/${event.id}`);
});

test("2. An unchanged field produces no proposal", async ({ request }) => {
  const event = await makePublishedEvent(request, { eventType: "airstrike" });
  const source = await makeManualSource(request);
  const item = await submitAndExtract(request, source.id, "Airstrike confirmed", "An airstrike was confirmed in the area, no further details.");

  await merge(request, item.id, event.id);
  const { proposals } = await request.get(`/api/admin/events/${event.id}/proposals`).then((r) => r.json());
  expect(proposals.some((p: { field: string }) => p.field === "eventType")).toBe(false);

  await request.delete(`/api/admin/events/${event.id}`);
});

test("3. Safe metadata (source attachment, corroboration count) updates automatically with no approval step", async ({ request }) => {
  const event = await makePublishedEvent(request);
  const before = await request.get(`/api/admin/events/${event.id}`).then((r) => r.json());
  const source = await makeManualSource(request);
  const item = await submitAndExtract(request, source.id, "Corroborating report", "Local witnesses confirmed an airstrike in Kyiv.");

  await merge(request, item.id, event.id);
  const after = await request.get(`/api/admin/events/${event.id}`).then((r) => r.json());
  expect(after.sourceCount).toBe(before.sourceCount + 1);

  await request.delete(`/api/admin/events/${event.id}`);
});

test("4. A proposed casualty change requires approval — the event's figure is unchanged until accepted", async ({ request }) => {
  const event = await makePublishedEvent(request);
  const source = await makeManualSource(request);
  const item = await submitAndExtract(request, source.id, "Casualty report", "Officials said 7 people were killed in the strike.");

  await merge(request, item.id, event.id);
  const afterMerge = await request.get(`/api/admin/events/${event.id}`).then((r) => r.json());
  expect(afterMerge.casualtiesKilled ?? null).toBeNull();

  const { proposals } = await request.get(`/api/admin/events/${event.id}/proposals`).then((r) => r.json());
  const casualtyProposal = proposals.find((p: { field: string; status: string }) => p.field === "casualtiesKilled" && p.status === "pending");
  expect(casualtyProposal).toBeTruthy();
  expect(casualtyProposal.proposedValue).toBe("7");

  await request.delete(`/api/admin/events/${event.id}`);
});

test("5. Accepting an update changes the current event and creates a history record", async ({ request }) => {
  const event = await makePublishedEvent(request, { severity: "elevated" });
  const source = await makeManualSource(request);
  const item = await submitAndExtract(request, source.id, "Escalation report", "The situation escalated sharply; 3 people were killed.");

  await merge(request, item.id, event.id);
  const { proposals } = await request.get(`/api/admin/events/${event.id}/proposals`).then((r) => r.json());
  const severityProposal = proposals.find((p: { field: string; status: string }) => p.field === "severity" && p.status === "pending");
  expect(severityProposal).toBeTruthy();

  const patchRes = await request.patch(`/api/admin/events/${event.id}/proposals/${severityProposal.id}`, { data: { action: "accept" } });
  expect(patchRes.ok()).toBe(true);
  const { event: updatedEvent } = await patchRes.json();
  expect(updatedEvent.severity).toBe("high");

  const afterFetch = await request.get(`/api/admin/events/${event.id}`).then((r) => r.json());
  expect(afterFetch.severity).toBe("high");
  expect(afterFetch.updatedAt).not.toBe(afterFetch.createdAt);

  const { history } = await request.get(`/api/admin/events/${event.id}/history`).then((r) => r.json());
  const entry = history.find((h: { field: string }) => h.field === "severity");
  expect(entry).toBeTruthy();
  expect(entry.oldValue).toBe("elevated");
  expect(entry.newValue).toBe("high");
  expect(entry.automatic).toBe(false);
  expect(entry.rawIngestionItemId).toBe(item.id);

  await request.delete(`/api/admin/events/${event.id}`);
});

test("6. Rejecting an update leaves the event completely unchanged and creates no history record", async ({ request }) => {
  const event = await makePublishedEvent(request, { severity: "elevated" });
  const source = await makeManualSource(request);
  const item = await submitAndExtract(request, source.id, "Escalation report", "Reports say the situation escalated; 4 people were killed.");

  await merge(request, item.id, event.id);
  const { proposals } = await request.get(`/api/admin/events/${event.id}/proposals`).then((r) => r.json());
  const severityProposal = proposals.find((p: { field: string; status: string }) => p.field === "severity" && p.status === "pending");
  expect(severityProposal).toBeTruthy();

  const patchRes = await request.patch(`/api/admin/events/${event.id}/proposals/${severityProposal.id}`, { data: { action: "reject" } });
  expect(patchRes.ok()).toBe(true);

  const afterFetch = await request.get(`/api/admin/events/${event.id}`).then((r) => r.json());
  expect(afterFetch.severity).toBe("elevated");

  const { history } = await request.get(`/api/admin/events/${event.id}/history`).then((r) => r.json());
  expect(history.some((h: { field: string }) => h.field === "severity")).toBe(false);

  const { proposals: after } = await request.get(`/api/admin/events/${event.id}/proposals`).then((r) => r.json());
  expect(after.find((p: { id: string }) => p.id === severityProposal.id).status).toBe("rejected");

  await request.delete(`/api/admin/events/${event.id}`);
});

test("7. Competing values from different reports coexist and are flagged as conflicting", async ({ request }) => {
  const event = await makePublishedEvent(request);
  const source = await makeManualSource(request);
  const itemA = await submitAndExtract(request, source.id, "First casualty report", "Local officials said 5 people were killed.");
  const itemB = await submitAndExtract(request, source.id, "Second casualty report", "Hospital sources said 9 people were killed.");

  await merge(request, itemA.id, event.id);
  await merge(request, itemB.id, event.id);

  const { proposals } = await request.get(`/api/admin/events/${event.id}/proposals`).then((r) => r.json());
  const killedProposals = proposals.filter((p: { field: string; status: string }) => p.field === "casualtiesKilled" && p.status === "pending");
  expect(killedProposals.length).toBe(2);
  const values = killedProposals.map((p: { proposedValue: string }) => p.proposedValue).sort();
  expect(values).toEqual(["5", "9"]);
  for (const p of killedProposals) expect(p.hasConflict).toBe(true);

  await request.delete(`/api/admin/events/${event.id}`);
});
