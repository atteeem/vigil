import { test, expect, type APIRequestContext } from "@playwright/test";
import { prisma } from "@/lib/db/client";

// Pre-Launch Critical Correctness & Security v1 §4 — report != event, same-batch corroboration. Root
// cause: bulk publishing evaluated the whole batch against a STALE, ingestion-time duplicateLikelihood
// snapshot, then publishRawItem always created a brand new Event — so several wire reports of the SAME
// real-world incident submitted in one bulk batch could never discover each other and each became its own
// Event. lib/ingestion/bulk-publish.ts now re-checks each candidate against live DB state (which already
// includes every event an earlier candidate in the SAME batch just created) via the EXISTING
// findDuplicateCandidates() matcher, and either attaches a specific-enough match as an additional source on
// the existing event (mergeReportIntoEvent — the same logic the admin's manual "Merge" action uses) or, for
// an advisory-only match, leaves it for a human exactly like the pre-existing cross-batch behavior.

const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

async function makeSource(request: APIRequestContext, label: string, sourceRole?: string) {
  const res = await request.post("/api/admin/sources", { data: { name: `SBC ${label} ${uid()}`, type: "manual", autoProcessing: true, ...(sourceRole ? { sourceRole } : {}) } });
  expect(res.ok()).toBeTruthy();
  return (await res.json()) as { id: string; name: string };
}

async function addReport(request: APIRequestContext, sourceId: string, title: string, text: string, publishedAt?: Date) {
  const url = `https://news.example-source.test/${uid()}`;
  const res = await request.post("/api/admin/incoming/manual", { data: { sourceId, originalTitle: title, originalText: text, originalUrl: url } });
  expect(res.ok()).toBeTruthy();
  const item = (await res.json()) as { id: string };
  if (publishedAt) await prisma.rawIngestionItem.update({ where: { id: item.id }, data: { publishedAt } });
  return { ...item, url };
}

const bulkPublish = (request: APIRequestContext, ids: string[]) => request.post("/api/admin/incoming/publish-bulk", { data: { filters: "status=pending", ids, mode: "publish" } });

async function eventsFor(request: APIRequestContext, urls: string[]) {
  const events = (await (await request.get("/api/events")).json()) as { id: string; title: string; sources: { url: string | null }[] }[];
  return urls.map((url) => events.find((e) => e.sources.some((s) => s.url === url)) ?? null);
}

test.describe("Same-batch corroboration (lib/ingestion/bulk-publish.ts)", () => {
  test("A. Three wire outlets describing the same strike become ONE event with multiple sources", async ({ request }) => {
    const bbc = await makeSource(request, "BBC-A");
    const reuters = await makeSource(request, "Reuters-A");
    const guardian = await makeSource(request, "Guardian-A");
    const text = "A Russian missile strike hit a power plant in Kharkiv on Tuesday, officials said, causing significant damage.";
    const r1 = await addReport(request, bbc.id, `Russian missile strike hits Kharkiv power plant ${uid()}`, text);
    const r2 = await addReport(request, reuters.id, `Russian missile strike hits Kharkiv power plant, officials say`, text);
    const r3 = await addReport(request, guardian.id, `Missile strike hits Kharkiv power plant`, text);

    const result = await (await bulkPublish(request, [r1.id, r2.id, r3.id])).json();
    expect(result.published).toBe(1);
    expect(result.corroborated).toBe(2);
    expect(result.failed).toBe(0);

    const [e1, e2, e3] = await eventsFor(request, [r1.url, r2.url, r3.url]);
    expect(e1).not.toBeNull();
    expect(e1!.id).toBe(e2!.id);
    expect(e1!.id).toBe(e3!.id);
    expect(e1!.sources).toHaveLength(3);
  });

  test("B. Two different attacks in the same city, hours apart, remain separate events", async ({ request }) => {
    const s1 = await makeSource(request, "B1");
    const s2 = await makeSource(request, "B2");
    const now = new Date();
    const r1 = await addReport(request, s1.id, `Explosion reported near Kharkiv railway station ${uid()}`, "Local officials said a railway facility was damaged in an explosion. No casualties were immediately reported.", now);
    const r2 = await addReport(
      request,
      s2.id,
      `Separate blast damages residential block in Kharkiv ${uid()}`,
      "A residential building in a different part of the city was hit hours later, emergency services said, with several apartments damaged.",
      new Date(now.getTime() - 6 * 3_600_000),
    );

    const result = await (await bulkPublish(request, [r1.id, r2.id])).json();
    // Same city (same gazetteer centroid — this matcher has no street-level precision), same exact event
    // type, several hours apart: a real, non-trivial score, correctly flagged for a human rather than
    // silently auto-merged (minutesApart exceeds the auto-corroborate window) OR silently published as a
    // second unrelated event with no awareness of the overlap at all.
    expect(result.corroborated).toBe(0);
    expect(result.published + result.skipped).toBe(2);
    if (result.skipped > 0) {
      const skippedOutcome = result.outcomes.find((o: { status: string }) => o.status === "skipped");
      expect(skippedOutcome.reasonCode).toBe("likely_duplicate");
    }

    // Whichever of the two actually got published (at most one — the other, if skipped, never becomes an
    // Event at all) is never merged into the other's event.
    const [e1, e2] = await eventsFor(request, [r1.url, r2.url]);
    if (e1 && e2) expect(e1.id).not.toBe(e2.id);
  });

  test("C. A syndicated/relay report of an already-corroborated story is attached as a relay, not counted as independent", async ({ request }) => {
    const originating = await makeSource(request, "C-Originating");
    const aggregator = await makeSource(request, "C-Aggregator", "aggregator");
    // Distinct location/weapon from tests A/B (which also use Kharkiv) so this test's reports cannot
    // accidentally match an event those tests left behind in the shared test DB.
    const text = "A drone strike hit a fuel depot in Odesa on Wednesday, local authorities reported, with a fire breaking out.";
    // Bulk publish processes newest-first (lib/ingestion/incoming-queue.ts's default sort), so the
    // aggregator's report is created FIRST here: it ends up older, processed SECOND, and matched against
    // the originating source's event — the scenario that actually exercises "a relay is attached as
    // relay, never as independent corroboration", regardless of which report a human happened to submit
    // first in the queue.
    const relay = await addReport(request, aggregator.id, `Drone strike hits Odesa fuel depot, authorities say`, text);
    const originatingReport = await addReport(request, originating.id, `Drone strike hits Odesa fuel depot ${uid()}`, text);

    const result = await (await bulkPublish(request, [originatingReport.id, relay.id])).json();
    expect(result.published).toBe(1);
    expect(result.corroborated).toBe(1);

    const [e1, e2] = await eventsFor(request, [originatingReport.url, relay.url]);
    expect(e1!.id).toBe(e2!.id);

    const eventSources = await prisma.eventSource.findMany({ where: { eventId: e1!.id }, include: { rawIngestionItem: true } });
    const relaySource = eventSources.find((es) => es.rawIngestionItem.originalUrl === relay.url);
    expect(relaySource?.relationship).toBe("relay");
    expect(relaySource?.isOriginatingSource).toBe(false);
  });

  test("D. Unrelated reports that merely share a country/conflict never merge", async ({ request }) => {
    const s1 = await makeSource(request, "D1");
    const s2 = await makeSource(request, "D2");
    const r1 = await addReport(request, s1.id, `Ukraine signs new grain export agreement with EU partners ${uid()}`, "The deal covers logistics and financing for agricultural exports over the next three years, officials said in Kyiv.");
    const r2 = await addReport(request, s2.id, `Drone strike hits Kharkiv industrial site ${uid()}`, "Local officials reported damage to several buildings following the strike overnight.");

    const result = await (await bulkPublish(request, [r1.id, r2.id])).json();
    expect(result.corroborated).toBe(0);

    const [e1, e2] = await eventsFor(request, [r1.url, r2.url]);
    if (e1 && e2) expect(e1.id).not.toBe(e2.id);
  });
});
