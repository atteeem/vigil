import { test, expect } from "@playwright/test";

// End-to-end coverage for Global Timeline / Historical Playback's public
// API — GET /api/events?at=<ISO> — exercised through the real dev
// server. Same request-fixture style as
// tests/event-reconstruction-api.spec.ts, which this milestone's
// endpoint reuses under the hood (reconstructWorldStateAt calls the same
// reconstructEventState pure logic).

function unique() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function createEvent(request: import("@playwright/test").APIRequestContext, overrides: Record<string, unknown> = {}) {
  const res = await request.post("/api/admin/events", {
    data: {
      title: `Timeline test event ${unique()}`,
      summary: "Independently written summary of the strike on Kyiv.",
      eventType: "airstrike",
      latitude: 50.45,
      longitude: 30.52,
      countryCode: "UA",
      region: "Europe",
      occurredAt: "2026-09-17T10:00:00.000Z",
      severity: "elevated",
      sourceName: `Timeline test source ${unique()}`,
      ...overrides,
    },
  });
  expect(res.ok()).toBe(true);
  return res.json();
}

async function makeManualSource(request: import("@playwright/test").APIRequestContext) {
  const res = await request.post("/api/admin/sources", { data: { name: `Timeline manual source ${unique()}`, type: "manual" } });
  expect(res.ok()).toBe(true);
  return res.json();
}

async function submitAndExtract(request: import("@playwright/test").APIRequestContext, sourceId: string, title: string, text: string) {
  const item = await request
    .post("/api/admin/incoming/manual", { data: { sourceId, externalId: unique(), originalTitle: title, originalText: text } })
    .then((r) => r.json());
  await request.post(`/api/admin/incoming/${item.id}/extract`);
  return item;
}

async function merge(request: import("@playwright/test").APIRequestContext, itemId: string, eventId: string) {
  const res = await request.post(`/api/admin/incoming/${itemId}/merge`, { data: { eventId } });
  expect(res.ok()).toBe(true);
}

interface EventListItem {
  id: string;
  severity: string;
  sourceCount: number;
}

async function findEvent(request: import("@playwright/test").APIRequestContext, at: string, eventId: string) {
  const res = await request.get(`/api/events?at=${encodeURIComponent(at)}`);
  expect(res.ok()).toBe(true);
  const events = (await res.json()) as EventListItem[];
  return events.find((e) => e.id === eventId);
}

test("1. A historical timestamp before an event was created hides it entirely", async ({ request }) => {
  const before = new Date().toISOString();
  const event = await createEvent(request);
  await request.post(`/api/admin/events/${event.id}/publish`);
  const after = new Date().toISOString();

  expect(await findEvent(request, before, event.id)).toBeUndefined();
  expect(await findEvent(request, after, event.id)).toBeTruthy();

  await request.delete(`/api/admin/events/${event.id}`);
});

test("2. An event's publication state is respected at T — unpublished events never appear, regardless of timestamp", async ({ request }) => {
  const event = await createEvent(request); // never published
  const now = new Date().toISOString();
  expect(await findEvent(request, now, event.id)).toBeUndefined();

  const live = await request.get("/api/events").then((r) => r.json());
  expect(live.some((e: { id: string }) => e.id === event.id)).toBe(false);

  await request.delete(`/api/admin/events/${event.id}`);
});

test("3. Event fields reconstruct to their historical value, not the current one", async ({ request }) => {
  const event = await createEvent(request, { severity: "elevated" });
  await request.post(`/api/admin/events/${event.id}/publish`);
  const beforeChange = new Date().toISOString();

  const source = await makeManualSource(request);
  const item = await submitAndExtract(request, source.id, "Escalation report", "The situation escalated sharply; 6 people were killed.");
  await merge(request, item.id, event.id);
  const { proposals } = await request.get(`/api/admin/events/${event.id}/proposals`).then((r) => r.json());
  const severityProposal = proposals.find((p: { field: string; status: string }) => p.field === "severity" && p.status === "pending");
  await request.patch(`/api/admin/events/${event.id}/proposals/${severityProposal.id}`, { data: { action: "accept" } });
  const afterChange = new Date().toISOString();

  const past = await findEvent(request, beforeChange, event.id);
  expect(past?.severity).toBe("elevated");

  const present = await findEvent(request, afterChange, event.id);
  expect(present?.severity).toBe("high");

  await request.delete(`/api/admin/events/${event.id}`);
});

test("4. Sources attached after the selected time are excluded from the historical event", async ({ request }) => {
  const event = await createEvent(request);
  await request.post(`/api/admin/events/${event.id}/publish`);
  const beforeSecondSource = new Date().toISOString();

  const source = await makeManualSource(request);
  const item = await submitAndExtract(request, source.id, "Corroborating report", "Local witnesses confirmed the strike.");
  await merge(request, item.id, event.id);
  const afterSecondSource = new Date().toISOString();

  const past = await findEvent(request, beforeSecondSource, event.id);
  expect(past?.sourceCount).toBe(1);

  const present = await findEvent(request, afterSecondSource, event.id);
  expect(present?.sourceCount).toBe(2);

  await request.delete(`/api/admin/events/${event.id}`);
});

test("5. Omitting 'at' returns live/current data, unaffected by any historical query made earlier", async ({ request }) => {
  const event = await createEvent(request, { severity: "elevated" });
  await request.post(`/api/admin/events/${event.id}/publish`);

  // A historical query for a moment before this event existed...
  const past = new Date(Date.now() - 60_000).toISOString();
  await request.get(`/api/events?at=${encodeURIComponent(past)}`);

  // ...must not affect the plain live endpoint.
  const live = await request.get("/api/events").then((r) => r.json());
  expect(live.some((e: { id: string }) => e.id === event.id)).toBe(true);

  await request.delete(`/api/admin/events/${event.id}`);
});

test("6. An invalid 'at' value is rejected cleanly (400), not a crash or silent fallback", async ({ request }) => {
  const res = await request.get("/api/events?at=not-a-real-timestamp");
  expect(res.status()).toBe(400);
});

test("7. A far-future 'at' value degrades to the current state rather than erroring", async ({ request }) => {
  const event = await createEvent(request, { severity: "elevated" });
  await request.post(`/api/admin/events/${event.id}/publish`);

  const future = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
  const found = await findEvent(request, future, event.id);
  expect(found?.severity).toBe("elevated");

  await request.delete(`/api/admin/events/${event.id}`);
});
