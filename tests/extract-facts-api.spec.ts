import { test, expect } from "@playwright/test";

// End-to-end coverage for the Structured Event Intelligence admin API
// (spec "Structured Event Intelligence") that can't be exercised as a
// pure function — persistence across edits, and comparison against a
// real Event row. Same request-fixture style as
// tests/event-lifecycle-api.spec.ts: no browser needed, just the
// dev server's API.

function unique() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function makeManualSource(request: import("@playwright/test").APIRequestContext) {
  const res = await request.post("/api/admin/sources", {
    data: { name: `Facts API Source ${unique()}`, type: "manual" },
  });
  expect(res.ok()).toBe(true);
  return res.json();
}

async function submitReport(request: import("@playwright/test").APIRequestContext, sourceId: string, text: string) {
  const res = await request.post("/api/admin/incoming/manual", {
    data: { sourceId, externalId: unique(), originalTitle: "Airstrike hits Kyiv", originalText: text },
  });
  expect(res.ok()).toBe(true);
  return res.json();
}

test("6. Source provenance is preserved across edits", async ({ request }) => {
  const source = await makeManualSource(request);
  const item = await submitReport(request, source.id, "An airstrike struck Kyiv, killing 5 people.");

  const extracted = await request.post(`/api/admin/incoming/${item.id}/extract`).then((r) => r.json());
  const eventTypeFact = extracted.facts.find((f: { field: string }) => f.field === "eventType");
  expect(eventTypeFact).toBeTruthy();
  expect(eventTypeFact.originalValue).toBeNull();
  expect(eventTypeFact.source).toBeTruthy(); // provenance present from the start

  // First edit: originalValue should capture the true extracted value.
  const firstEdit = await request
    .patch(`/api/admin/incoming/${item.id}/facts/${eventTypeFact.id}`, { data: { action: "edit", value: "drone" } })
    .then((r) => r.json());
  expect(firstEdit.value).toBe("drone");
  expect(firstEdit.originalValue).toBe("airstrike");
  expect(firstEdit.status).toBe("edited");

  // Second edit: originalValue must stay the FIRST extracted value, not
  // the intermediate edit — spec "preserve original wording/source
  // evidence... for provenance" means the true origin, not the last hop.
  const secondEdit = await request
    .patch(`/api/admin/incoming/${item.id}/facts/${eventTypeFact.id}`, { data: { action: "edit", value: "missile" } })
    .then((r) => r.json());
  expect(secondEdit.value).toBe("missile");
  expect(secondEdit.originalValue).toBe("airstrike");
});

test("7. Extraction and fact review never auto-publish or modify an event", async ({ request }) => {
  const source = await makeManualSource(request);
  const item = await submitReport(request, source.id, "An airstrike struck Kyiv, killing 5 people.");

  const before = await request.get("/api/admin/events").then((r) => r.json());

  const extracted = await request.post(`/api/admin/incoming/${item.id}/extract`).then((r) => r.json());
  expect(extracted.facts.length).toBeGreaterThan(0);

  // Accept and edit some facts — still just admin-side annotations.
  const titleFact = extracted.facts.find((f: { field: string }) => f.field === "title");
  await request.patch(`/api/admin/incoming/${item.id}/facts/${titleFact.id}`, { data: { action: "accept" } });
  const eventTypeFact = extracted.facts.find((f: { field: string }) => f.field === "eventType");
  await request.patch(`/api/admin/incoming/${item.id}/facts/${eventTypeFact.id}`, { data: { action: "reject" } });

  const afterItem = await request.get(`/api/admin/incoming?status=pending`).then((r) => r.json());
  const stillPending = afterItem.find((i: { id: string }) => i.id === item.id);
  expect(stillPending).toBeTruthy(); // never silently published

  const after = await request.get("/api/admin/events").then((r) => r.json());
  expect(after.length).toBe(before.length); // no event created or altered
});

test("8. Field-diff comparison highlights what changed vs. a matched event", async ({ request }) => {
  const eventFields = {
    title: `Airstrike hits Kyiv ${unique()}`,
    summary: "Independently written summary of the strike on Kyiv.",
    eventType: "airstrike",
    latitude: 50.45,
    longitude: 30.52,
    countryCode: "UA",
    region: "Europe",
    occurredAt: new Date().toISOString(),
    severity: "elevated",
    sourceName: `Facts API Matched Source ${unique()}`,
  };
  const eventRes = await request.post("/api/admin/events", { data: eventFields });
  expect(eventRes.ok()).toBe(true);
  const event = await eventRes.json();
  await request.post(`/api/admin/events/${event.id}/publish`);

  const source = await makeManualSource(request);
  // Same place (matches), but new escalation language pushes severity to
  // "high" — a deliberate difference from the matched event's "elevated".
  const item = await submitReport(
    request,
    source.id,
    "A fresh airstrike struck Kyiv again overnight; 12 people were killed in a residential block.",
  );
  await request.post(`/api/admin/incoming/${item.id}/extract`);

  const result = await request.get(`/api/admin/incoming/${item.id}/facts`).then((r) => r.json());
  expect(result.matchedEvent).toBeTruthy();
  expect(result.matchedEvent.eventId).toBe(event.id);

  const diffByField = new Map(result.fieldDiffs.map((d: { field: string }) => [d.field, d]));
  const eventTypeDiff = diffByField.get("eventType") as { differs: boolean; currentEventValue: string } | undefined;
  expect(eventTypeDiff?.differs).toBe(false);
  expect(eventTypeDiff?.currentEventValue).toBe("airstrike");

  const severityDiff = diffByField.get("severity") as
    | { differs: boolean; currentEventValue: string; extractedValue: string }
    | undefined;
  expect(severityDiff?.extractedValue).toBe("high");
  expect(severityDiff?.currentEventValue).toBe("elevated");
  expect(severityDiff?.differs).toBe(true);

  await request.delete(`/api/admin/events/${event.id}`);
});
