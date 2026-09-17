import { test, expect } from "@playwright/test";

const fields = () => ({
  title: `Lifecycle API ${Date.now()}-${Math.random()}`,
  summary: "Local lifecycle regression fixture",
  eventType: "other",
  latitude: 48.85,
  longitude: 2.35,
  occurredAt: "2026-09-17T10:12:34.567Z",
  severity: "elevated",
  sourceName: `Lifecycle API Source ${Date.now()}-${Math.random()}`,
});

test("draft is the default and first publication time survives unpublish and republish", async ({ request }) => {
  const created = await request.post("/api/admin/events", { data: fields() });
  expect(created.status()).toBe(201);
  const event = await created.json();
  const url = `/api/admin/events/${event.id}`;
  expect((await request.get(url).then(r => r.json())).status).toBe("draft");
  const published = await request.post(`${url}/publish`).then(r => r.json());
  expect(published.publishedAt).toBeTruthy();
  await request.post(`${url}/unpublish`);
  const hidden = await request.get(url).then(r => r.json());
  expect(hidden.status).toBe("unpublished");
  expect(hidden.publishedAt).toBe(published.publishedAt);
  expect((await request.post(`${url}/publish`).then(r => r.json())).publishedAt).toBe(published.publishedAt);
  expect((await request.delete(url)).ok()).toBe(true);
});

test("incoming publication records lifecycle history", async ({ request }) => {
  const source = await request.post("/api/admin/sources", { data: { name: fields().sourceName, type: "manual" } }).then(r => r.json());
  const item = await request.post("/api/admin/incoming/manual", { data: { sourceId: source.id, externalId: fields().title, originalTitle: "Lifecycle incoming fixture" } }).then(r => r.json());
  const published = await request.post(`/api/admin/incoming/${item.id}/publish`, { data: fields() }).then(r => r.json());
  expect(published.publishedAt).toBeTruthy();
  await request.post(`/api/admin/events/${published.id}/unpublish`);
  expect((await request.get(`/api/admin/events/${published.id}`).then(r => r.json())).status).toBe("unpublished");
  expect((await request.delete(`/api/admin/events/${published.id}`)).ok()).toBe(true);
});

test("deleting one event preserves a report still linked to another event", async ({ request }) => {
  const firstFields = fields();
  const first = await request.post("/api/admin/events", { data: firstFields }).then(r => r.json());
  const second = await request.post("/api/admin/events", { data: fields() }).then(r => r.json());
  const items = await request.get("/api/admin/incoming?status=published").then(r => r.json());
  const report = items.find((item: { originalTitle: string }) => item.originalTitle === firstFields.title);
  expect(report).toBeTruthy();
  expect((await request.post(`/api/admin/incoming/${report.id}/merge`, { data: { eventId: second.id } })).ok()).toBe(true);
  expect((await request.delete(`/api/admin/events/${first.id}`)).ok()).toBe(true);
  const merged = await request.get("/api/admin/incoming?status=merged").then(r => r.json());
  expect(merged.some((item: { id: string }) => item.id === report.id)).toBe(true);
  expect((await request.get(`/api/admin/events/${second.id}`).then(r => r.json())).sources).toHaveLength(2);
  expect((await request.delete(`/api/admin/events/${second.id}`)).ok()).toBe(true);
  const pending = await request.get("/api/admin/incoming?status=pending").then(r => r.json());
  expect(pending.some((item: { id: string }) => item.id === report.id)).toBe(true);
});

test("invalid create and edit inputs are rejected without changing the event", async ({ request }) => {
  for (const patch of [{ latitude: 91 }, { occurredAt: "invalid" }, { title: " " }, { sourceUrl: "javascript:alert(1)" }]) {
    expect((await request.post("/api/admin/events", { data: { ...fields(), ...patch } })).status()).toBe(400);
  }
  const event = await request.post("/api/admin/events", { data: fields() }).then(r => r.json());
  for (const patch of [{ longitude: 181 }, { importance: 101 }, { summary: "" }, { verificationStatus: "invalid" }]) {
    expect((await request.patch(`/api/admin/events/${event.id}`, { data: patch })).status()).toBe(400);
  }
  const after = await request.get(`/api/admin/events/${event.id}`).then(r => r.json());
  expect(after.title).toBe(event.title);
  expect(after.occurredAt).toBe(event.occurredAt);
  expect((await request.delete(`/api/admin/events/${event.id}`)).ok()).toBe(true);
});
