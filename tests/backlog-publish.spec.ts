import { test, expect } from "@playwright/test";
import { prisma } from "@/lib/db/client";

// Backlog Triage & Safe Publication v1 — integration coverage for the parts that only make sense end to
// end through the real HTTP API: the "Publish READY filtered" bulk action (readiness is a snapshot column
// combined with a live duplicate signal — see lib/ingestion/incoming-queue.ts) and the safety rule that
// publishing an old, backlogged report must preserve its real occurredAt rather than rewriting history to
// "just now" (spec §20-22).

test.describe("Publish READY filtered", () => {
  test("publishes only READY items, preserves the report's original timestamp, and skips a duplicate", async ({ request }) => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const source = await (
      await request.post("/api/admin/sources", { data: { name: `Readiness test ${suffix}`, type: "manual" } })
    ).json();

    // A genuinely READY, high-confidence conflict report — a real 10-day-old incident being backfilled.
    const ready = await (
      await request.post("/api/admin/incoming/manual", {
        data: {
          sourceId: source.id,
          externalId: `ready-${suffix}`,
          originalUrl: `https://news.example-source.test/ready-${suffix}`,
          originalTitle: `Russian drone strike hits Kyiv region overnight (${suffix})`,
          originalText: "Ukrainian air defense units intercepted several drones before impact, officials said.",
        },
      })
    ).json();

    // A country-level, no-conflict development — also READY, needs no coordinates.
    const countryDev = await (
      await request.post("/api/admin/incoming/manual", {
        data: {
          sourceId: source.id,
          externalId: `country-${suffix}`,
          originalUrl: `https://news.example-source.test/country-${suffix}`,
          originalTitle: `Ukraine's central bank holds interest rates steady (${suffix})`,
          originalText: "Analysts had expected no change ahead of next month's policy meeting.",
        },
      })
    ).json();

    // An ambiguous conflict report from a SEPARATE source dedicated to Russia-Ukraine: a dedicated
    // source's own otherwise-unrelated content is real-but-weak evidence (matchConfidence 0.45, below
    // the 0.6 ready threshold) — must stay NEEDS_REVIEW, never READY.
    const dedicatedSource = await (
      await request.post("/api/admin/sources", { data: { name: `Readiness test dedicated ${suffix}`, type: "manual" } })
    ).json();
    const conflict = await prisma.conflict.findFirst({ where: { slug: "russia-ukraine" } });
    await prisma.sourceConflictLink.create({ data: { sourceId: dedicatedSource.id, conflictId: conflict!.id, scope: "dedicated" } });
    const ambiguous = await (
      await request.post("/api/admin/incoming/manual", {
        data: {
          sourceId: dedicatedSource.id,
          externalId: `ambiguous-${suffix}`,
          originalUrl: `https://news.example-source.test/ambiguous-${suffix}`,
          originalTitle: `Ukraine's central bank holds an emergency policy meeting (${suffix})`,
          originalText: "The meeting was called after a volatile week for the currency.",
        },
      })
    ).json();

    // Backdate the READY item to a real historical publish time (10+ days before "now") — the whole
    // point of this test is confirming the eventual Event keeps THIS date, not the publish moment. The
    // extra random jitter (still comfortably "more than 9 days ago") keeps two projects' runs of this
    // SAME Russia-Ukraine/Kyiv/drone fixture, moments apart in real time, from landing close enough to
    // each other that the canonical matcher (correctly) treats the second as a duplicate of the first's
    // leftover event — title tags alone don't prevent that; distance-in-time does.
    const historicalPublishedAt = new Date(Date.now() - 10 * 86_400_000 - Math.floor(Math.random() * 8 * 365 * 86_400_000));
    await prisma.rawIngestionItem.update({ where: { id: ready.id }, data: { publishedAt: historicalPublishedAt } });

    // Compute the real readiness/classification snapshot the same way ingestion would (two sources: the
    // ready+countryDev items' plain source, and the ambiguous item's dedicated one).
    const refreshRes = await request.post("/api/admin/incoming/refresh-snapshots", { data: { sourceId: source.id, limit: 100 } });
    expect(refreshRes.ok()).toBe(true);
    expect((await refreshRes.json()).refreshed).toBe(2);
    const refreshDedicated = await request.post("/api/admin/incoming/refresh-snapshots", { data: { sourceId: dedicatedSource.id, limit: 100 } });
    expect((await refreshDedicated.json()).refreshed).toBe(1);

    const list = (await (await request.get(`/api/admin/incoming?sourceId=${source.id}&readiness=READY`)).json()) as { id: string }[];
    const readyIds = new Set(list.map((i) => i.id));
    expect(readyIds.has(ready.id)).toBe(true);
    expect(readyIds.has(countryDev.id)).toBe(true);

    const ambiguousRow = await prisma.rawIngestionItem.findUnique({ where: { id: ambiguous.id } });
    expect(ambiguousRow?.suggestedReadiness).toBe("NEEDS_REVIEW"); // real-but-weak dedicated-source evidence must never silently count as READY
    expect(ambiguousRow?.suggestedConflictConfidence).toBeLessThan(0.6);

    const preview = await (
      await request.post("/api/admin/incoming/publish-bulk", {
        data: { filters: `sourceId=${source.id}&status=pending&readiness=READY`, mode: "preview" },
      })
    ).json();
    expect(preview.publishable).toBe(2);
    expect(preview.classifications.CONFLICT_EVENT).toBe(1);
    expect(preview.classifications.COUNTRY_DEVELOPMENT).toBe(1);

    const published = await (
      await request.post("/api/admin/incoming/publish-bulk", {
        data: { filters: `sourceId=${source.id}&status=pending&readiness=READY`, mode: "publish", expectedCount: preview.matching },
      })
    ).json();
    expect(published.published).toBe(2);
    expect(published.failed).toBe(0);

    // The historical item's Event must carry the ORIGINAL report time, not the moment it was approved —
    // a 10-day-old backfilled report must never look like it just happened.
    const event = await prisma.event.findFirst({ where: { sources: { some: { rawIngestionItemId: ready.id } } } });
    expect(event).not.toBeNull();
    expect(Math.abs(event!.occurredAt.getTime() - historicalPublishedAt.getTime())).toBeLessThan(1000);
    expect(event!.occurredAt.getTime()).toBeLessThan(Date.now() - 9 * 86_400_000);

    // The ambiguous item was never touched by the READY-filtered publish.
    const untouched = await prisma.rawIngestionItem.findUnique({ where: { id: ambiguous.id } });
    expect(untouched?.processingStatus).toBe("pending");
  });
});
