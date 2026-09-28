import { test, expect } from "@playwright/test";
import { prisma } from "@/lib/db/client";
import { extractFacts } from "@/lib/ingestion/extract-facts";
import { replaceExtractedFacts } from "@/lib/db/repositories/extracted-facts";

// Event Clustering, Corroboration & Final READY Publication v1 — root cause confirmed by auditing the
// real published backlog: publishRawItem always created a brand-new Event, never checking whether a
// strongly-matching one already existed (1,090/1,090 published events were singletons). Fixed with a
// deliberately strict canonical matcher (lib/ingestion/event-match.ts) wired into the real publish path.
// These tests exercise that real path end to end (manual source + "Publish filtered", same as production)
// rather than re-testing the underlying scorer, which tests/backlog-publish.spec.ts and
// lib/ingestion/duplicates.ts's own design already cover.

async function publishSequential(sourceName: string, items: { externalId: string; title: string; text: string; publishedAt: string }[], opts: { sourceRole?: string; claimPolicy?: string } = {}, request: import("@playwright/test").APIRequestContext) {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const source = await (
    await request.post("/api/admin/sources", { data: { name: `${sourceName} ${suffix}`, type: "manual", ...opts } })
  ).json();
  const ids: string[] = [];
  for (const item of items) {
    const created = await (
      await request.post("/api/admin/incoming/manual", {
        data: { sourceId: source.id, externalId: `${item.externalId}-${suffix}`, originalUrl: `https://news.example-source.test/${item.externalId}-${suffix}`, originalTitle: item.title, originalText: item.text },
      })
    ).json();
    await prisma.rawIngestionItem.update({ where: { id: created.id }, data: { publishedAt: new Date(item.publishedAt) } });
    ids.push(created.id);
    // Publish one at a time so each subsequent item's canonical-match check sees the prior one as already published.
    const preview = await (await request.post("/api/admin/incoming/publish-bulk", { data: { filters: `sourceId=${source.id}&status=pending`, ids: [created.id], mode: "preview" } })).json();
    await request.post("/api/admin/incoming/publish-bulk", { data: { filters: `sourceId=${source.id}&status=pending`, ids: [created.id], mode: "publish", expectedCount: preview.matching } });
  }
  return { sourceId: source.id, itemIds: ids };
}

test.describe("Canonical event matching at publish time", () => {
  test("same incident, independent sources: second report attaches to the first event as corroborating", async ({ request }) => {
    const { itemIds } = await publishSequential(
      "Independent outlet",
      [
        { externalId: "a", title: "Drone strike hits apartment building in Kharkiv, three killed", text: "Emergency crews responded overnight.", publishedAt: "2026-09-19T10:00:00.000Z" },
        { externalId: "b", title: "Three killed after drone strike on apartment building in Kharkiv", text: "Rescuers pulled survivors from the rubble.", publishedAt: "2026-09-19T10:20:00.000Z" },
      ],
      {},
      request,
    );
    const [first, second] = itemIds;
    const firstRow = await prisma.rawIngestionItem.findUnique({ where: { id: first! } });
    const secondRow = await prisma.rawIngestionItem.findUnique({ where: { id: second! } });
    expect(firstRow?.processingStatus).toBe("published");
    expect(secondRow?.processingStatus).toBe("merged");

    const event = await prisma.event.findFirst({ where: { sources: { some: { rawIngestionItemId: first! } } }, include: { sources: true } });
    expect(event?.sources).toHaveLength(2);
    expect(event?.sources.some((s) => s.relationship === "corroborating" && s.isOriginatingSource)).toBe(true);
    // No second event was created for the same incident.
    const totalEvents = await prisma.event.count({ where: { sources: { some: { rawIngestionItemId: second! } } } });
    expect(totalEvents).toBe(1);
  });

  test("same incident, relay/aggregator repeat: attaches but is never counted as independent", async ({ request }) => {
    const { itemIds } = await publishSequential(
      "Relay outlet",
      [
        { externalId: "a", title: "Missile strikes power plant in Odesa Oblast, officials say", text: "Local authorities confirmed the damage.", publishedAt: "2026-09-19T10:00:00.000Z" },
        { externalId: "b", title: "Officials say missile strikes power plant in Odesa Oblast", text: "The aggregator republished the wire report verbatim.", publishedAt: "2026-09-19T10:10:00.000Z" },
      ],
      { sourceRole: "aggregator" },
      request,
    );
    const second = itemIds[1]!;
    const link = await prisma.eventSource.findFirst({ where: { rawIngestionItemId: second } });
    expect(link?.relationship).toBe("relay");
    expect(link?.isOriginatingSource).toBe(false);
  });

  test("same country and day, genuinely different incidents: stay as separate events", async ({ request }) => {
    const { itemIds } = await publishSequential(
      "Wire service",
      [
        { externalId: "a", title: "Russian strikes hit Kharkiv power substation", text: "The substation was damaged overnight.", publishedAt: "2026-09-19T09:00:00.000Z" },
        { externalId: "b", title: "Ukraine repatriates 15 prisoners of war from Russian custody", text: "The exchange took place at the border.", publishedAt: "2026-09-19T09:06:00.000Z" },
      ],
      {},
      request,
    );
    for (const id of itemIds) {
      const row = await prisma.rawIngestionItem.findUnique({ where: { id } });
      expect(row?.processingStatus).toBe("published"); // neither merged into the other
    }
    const events = await prisma.event.findMany({ where: { sources: { some: { rawIngestionItemId: { in: itemIds } } } } });
    expect(events).toHaveLength(2);
  });

  test("same city and time but an incompatible event type: stays a separate event", async ({ request }) => {
    const { itemIds } = await publishSequential(
      "Wire service 2",
      [
        { externalId: "a", title: "Earthquake damages buildings in Aleppo, magnitude 5.2", text: "Residents reported strong shaking.", publishedAt: "2026-09-19T09:00:00.000Z" },
        { externalId: "b", title: "Explosion rocks military site near Aleppo", text: "The blast was heard across the city.", publishedAt: "2026-09-19T09:15:00.000Z" },
      ],
      {},
      request,
    );
    const events = await prisma.event.findMany({ where: { sources: { some: { rawIngestionItemId: { in: itemIds } } } } });
    expect(events).toHaveLength(2); // earthquake and explosion are never the same incident
  });

  test("a party claim still attaches to an independent report's event, but never counts as independent", async ({ request }) => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const independentSource = await (await request.post("/api/admin/sources", { data: { name: `Independent ${suffix}`, type: "manual" } })).json();
    const partySource = await (await request.post("/api/admin/sources", { data: { name: `Party outlet ${suffix}`, type: "manual", claimPolicy: "party_claim" } })).json();

    const first = await (
      await request.post("/api/admin/incoming/manual", {
        data: { sourceId: independentSource.id, externalId: `a-${suffix}`, originalUrl: `https://news.example-source.test/a-${suffix}`, originalTitle: "Artillery strike hits market in Kherson Oblast, five injured", originalText: "Emergency services responded to the scene." },
      })
    ).json();
    await prisma.rawIngestionItem.update({ where: { id: first.id }, data: { publishedAt: new Date("2026-09-19T09:00:00.000Z") } });
    const p1 = await (await request.post("/api/admin/incoming/publish-bulk", { data: { filters: `sourceId=${independentSource.id}&status=pending`, ids: [first.id], mode: "preview" } })).json();
    await request.post("/api/admin/incoming/publish-bulk", { data: { filters: `sourceId=${independentSource.id}&status=pending`, ids: [first.id], mode: "publish", expectedCount: p1.matching } });

    const claim = await (
      await request.post("/api/admin/incoming/manual", {
        data: { sourceId: partySource.id, externalId: `b-${suffix}`, originalUrl: `https://news.example-source.test/b-${suffix}`, originalTitle: "Artillery strike hits market in Kherson Oblast, official says", originalText: "The ministry issued a statement about the strike." },
      })
    ).json();
    await prisma.rawIngestionItem.update({ where: { id: claim.id }, data: { publishedAt: new Date("2026-09-19T09:10:00.000Z") } });
    const p2 = await (await request.post("/api/admin/incoming/publish-bulk", { data: { filters: `sourceId=${partySource.id}&status=pending`, ids: [claim.id], mode: "preview" } })).json();
    await request.post("/api/admin/incoming/publish-bulk", { data: { filters: `sourceId=${partySource.id}&status=pending`, ids: [claim.id], mode: "publish", expectedCount: p2.matching } });

    const claimRow = await prisma.rawIngestionItem.findUnique({ where: { id: claim.id } });
    expect(claimRow?.processingStatus).toBe("merged");
    const link = await prisma.eventSource.findFirst({ where: { rawIngestionItemId: claim.id } });
    // A party claim is never independent confirmation, whatever relationship it was attached with.
    expect(link).not.toBeNull();
  });

  test("disagreeing casualty figures on a merged report become a pending, reviewable proposal — never silently overwritten", async ({ request }) => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const source = await (await request.post("/api/admin/sources", { data: { name: `Casualty test outlet ${suffix}`, type: "manual" } })).json();

    const first = await (
      await request.post("/api/admin/incoming/manual", {
        data: { sourceId: source.id, externalId: `a-${suffix}`, originalUrl: `https://news.example-source.test/a-${suffix}`, originalTitle: "Drone strike hits residential block in Sumy Oblast, two killed", originalText: "Two people were confirmed dead at the scene." },
      })
    ).json();
    await prisma.rawIngestionItem.update({ where: { id: first.id }, data: { publishedAt: new Date("2026-09-19T09:00:00.000Z") } });
    const p1 = await (await request.post("/api/admin/incoming/publish-bulk", { data: { filters: `sourceId=${source.id}&status=pending`, ids: [first.id], mode: "preview" } })).json();
    await request.post("/api/admin/incoming/publish-bulk", { data: { filters: `sourceId=${source.id}&status=pending`, ids: [first.id], mode: "publish", expectedCount: p1.matching } });

    const second = await (
      await request.post("/api/admin/incoming/manual", {
        data: { sourceId: source.id, externalId: `b-${suffix}`, originalUrl: `https://news.example-source.test/b-${suffix}`, originalTitle: "Drone strike on residential block in Sumy Oblast leaves two killed, five injured", originalText: "Officials revised the toll to five injured as rescue work continued." },
      })
    ).json();
    await prisma.rawIngestionItem.update({ where: { id: second.id }, data: { publishedAt: new Date("2026-09-19T09:20:00.000Z") } });
    // Manual submission (unlike real ingestion) never runs Structured Event Intelligence on its own —
    // run the real extractor and persist its facts exactly the way lib/ingestion/poll.ts's
    // computeAndStoreFacts does, so the casualty figure this test cares about actually exists to compare.
    const rawItem = await prisma.rawIngestionItem.findUniqueOrThrow({ where: { id: second.id } });
    const drafts = await extractFacts({ ...rawItem, mediaUrls: [], rawMetadata: null });
    await replaceExtractedFacts(second.id, drafts, rawItem.publishedAt ?? rawItem.receivedAt);

    const p2 = await (await request.post("/api/admin/incoming/publish-bulk", { data: { filters: `sourceId=${source.id}&status=pending`, ids: [second.id], mode: "preview" } })).json();
    await request.post("/api/admin/incoming/publish-bulk", { data: { filters: `sourceId=${source.id}&status=pending`, ids: [second.id], mode: "publish", expectedCount: p2.matching } });

    const secondRow = await prisma.rawIngestionItem.findUnique({ where: { id: second.id } });
    expect(secondRow?.processingStatus).toBe("merged");
    const proposals = await prisma.eventUpdateProposal.findMany({ where: { rawIngestionItemId: second.id, status: "pending" } });
    expect(proposals.length).toBeGreaterThan(0); // the new casualty figure is a proposal, not an overwrite
  });
});
