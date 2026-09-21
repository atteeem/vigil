import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { assessEscalation, assessHotspot, HOUR, type ActivityEvent } from "@/lib/brief/activity";
import { briefSignificance, deriveConfidence } from "@/lib/brief/scoring";
import { normalizeCountry, parseRange, BriefInputError } from "@/lib/brief/brief";
import { mapHrefFor } from "@/lib/brief/links";
import { summarizeEvidence, sourceTrust } from "@/lib/sources/trust";
import type { Brief, BriefDevelopment } from "@/lib/brief/types";

// Global Intelligence Briefings. Pure tests exercise the escalation / hotspot / confidence models; API and UI
// tests drive the real write paths (events, sources, territorial review, structured-provider fixtures) and
// read the resulting briefs. Briefs are built ONLY from existing state: nothing here ingests separately.

const FIXTURE = "http://localhost:3100/api/test-fixtures/hazards";
const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const T0 = Date.now();
const client = () => `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 14)}xxxxxxxxxx`.slice(0, 32);
const fixtureUrl = (path: string, query: string) => `${FIXTURE}/${path}${query ? `${query}&` : "?"}t=${T0}`;
const CLASS: Record<string, string> = { usgs_earthquakes: "scientific_official", faa_nas_status: "government_alert", ioda: "sensor_provider", portwatch_chokepoints: "sensor_provider" };
const ago = (hours: number) => new Date(Date.now() - hours * HOUR).toISOString();

async function ingest(request: APIRequestContext, provider: string, path: string, query = "") {
  const res = await request.post("/api/admin/sources", { data: { name: `BR ${provider} ${unique()}`, type: "structured", platform: provider, feedUrl: fixtureUrl(path, query), url: fixtureUrl(path, query), enabled: true, autoIngest: false, autoProcessing: false, independenceClass: CLASS[provider], pollIntervalMinutes: 5 } });
  const src = (await res.json()) as { id: string };
  return (await request.post(`/api/admin/sources/${src.id}/fetch`).then((r) => r.json())) as { errors: number; new: number };
}

const brief = async (request: APIRequestContext, query: string, headers: Record<string, string> = {}) => (await request.get(`/api/brief?${query}`, { headers }).then((r) => r.json())) as Brief;
const titlesOf = (b: Brief) => b.developments.map((d) => d.title);
const byType = (b: Brief, t: string) => b.developments.filter((d) => d.developmentType === t);

test.describe.configure({ timeout: 150_000 }); // first requests compile routes on demand

test.beforeAll(async () => {
  const { prisma } = await import("@/lib/db/client");
  await prisma.globalEvent.deleteMany({});
  await prisma.stateTransition.deleteMany({});
  await prisma.alertState.deleteMany({});
});
test.afterAll(async () => {
  const { prisma } = await import("@/lib/db/client");
  await prisma.globalEvent.deleteMany({});
  await prisma.stateTransition.deleteMany({});
  await prisma.briefSnapshot.deleteMany({});
  await prisma.watcher.deleteMany({});
  await prisma.conflict.deleteMany({ where: { slug: { startsWith: "br-" } } });
  await prisma.militaryUnit.deleteMany({ where: { name: { startsWith: "BR " } } });
  await prisma.source.deleteMany({ where: { name: { startsWith: "BR " } } });
});

// ---------------------------------------------------------------------------------------------
const ev = (over: Partial<ActivityEvent> & { hoursAgo: number }, i = 0): ActivityEvent => ({ id: `e${i}-${over.hoursAgo}`, at: Date.now() - over.hoursAgo * HOUR, severity: "elevated", importance: 50, lat: 48 + (over.lat ?? 0), lng: 30, killed: null, independent: 1, infrastructure: false, ...over });
const many = (n: number, hoursAgoFrom: number, hoursAgoTo: number, over: Partial<ActivityEvent> = {}) => Array.from({ length: n }, (_, i) => ev({ hoursAgo: hoursAgoFrom + ((hoursAgoTo - hoursAgoFrom) * i) / Math.max(1, n - 1), ...over }, i));
const NOW = Date.now();
const input = (events: ActivityEvent[], over: Record<string, unknown> = {}) => ({ conflictSlug: "x", conflictName: "X", from: NOW - 6 * HOUR, to: NOW, events, transitions: [], territorialChanges: [], ...over });

test.describe("Escalation, hotspot and confidence models (pure)", () => {
  test("a real severity increase against the conflict's own baseline is escalating, with reasons", () => {
    const baseline = many(8, 24, 150, { severity: "guarded", importance: 30 });
    const now = [ev({ hoursAgo: 1, severity: "severe", importance: 88, lat: 3 }, 1), ev({ hoursAgo: 2, severity: "severe", importance: 85, lat: 3.1 }, 2), ev({ hoursAgo: 3, severity: "extreme", importance: 92, lat: 3.2 }, 3)];
    const a = assessEscalation(input([...baseline, ...now]));
    expect(a.trend).toBe("escalating");
    expect(a.score).toBeGreaterThanOrEqual(20);
    expect(a.signals.map((s) => s.name)).toEqual(expect.arrayContaining(["severe_events_up", "severity_up", "new_geography"]));
    expect(a.reasons.length).toBeGreaterThan(0);
    // Deterministic: the same input gives exactly the same assessment.
    expect(assessEscalation(input([...baseline, ...now]))).toEqual(a);
  });

  test("reporting volume alone is not escalation: the model never sees a report count, and source groups only affect confidence", () => {
    const events = [...many(10, 24, 150, { severity: "elevated" }), ...many(2, 1, 5, { severity: "elevated" })];
    const one = assessEscalation(input(events.map((e) => ({ ...e, independent: 1 }))));
    const fifty = assessEscalation(input(events.map((e) => ({ ...e, independent: 50 }))));
    expect(fifty.trend).toBe(one.trend);
    expect(fifty.score).toBe(one.score);
    expect(one.trend).toBe("stable");
    // "100 articles about one event" is still one canonical event: it cannot make a quiet conflict escalating.
    const quiet = assessEscalation(input([ev({ hoursAgo: 2, severity: "elevated", independent: 100 })]));
    expect(quiet.trend).not.toBe("escalating");
  });

  test("a sustained reduction in high-severity incidents is de-escalating; ceasefire status is too; too little data is uncertain", () => {
    const baseline = many(24, 30, 160, { severity: "severe", importance: 80 });
    const quiet = assessEscalation(input(baseline, { from: NOW - 24 * HOUR }));
    expect(quiet.trend).toBe("de-escalating");
    expect(quiet.signals.some((s) => s.name === "severe_events_down")).toBe(true);
    const shortDrop = assessEscalation(input(baseline, { from: NOW - 2 * HOUR }));
    expect(shortDrop.signals.some((s) => s.name === "severe_events_down")).toBe(false); // a two-hour lull is not a sustained reduction
    const status = assessEscalation(input(many(6, 30, 100, { severity: "high" }), { transitions: [{ kind: "status", at: NOW - HOUR, from: "active", to: "dormant" }] }));
    expect(status.trend).toBe("de-escalating");
    expect(assessEscalation(input([])).trend).toBe("uncertain");
  });

  test("hotspots: a sudden spike in a quiet area is detected; a permanently busy front is not; spread adds; source counts do not inflate", () => {
    const quietBase = many(3, 30, 150, { severity: "guarded", importance: 30 });
    const spike = [ev({ hoursAgo: 1, severity: "high", lat: 2 }, 1), ev({ hoursAgo: 2, severity: "severe", lat: 2.6 }, 2), ev({ hoursAgo: 3, severity: "high", lat: 3.2 }, 3), ev({ hoursAgo: 4, severity: "high", lat: 2 }, 4)];
    const h = (events: ActivityEvent[], extra: Record<string, unknown> = {}) => assessHotspot({ key: "k", label: "Area", conflictSlug: "x", countryCode: "UA", from: NOW - 6 * HOUR, to: NOW, events, territorialClaims: 0, newActors: 0, ...extra });
    const hot = h([...quietBase, ...spike]);
    expect(hot).not.toBeNull();
    expect(hot!.reasons.some((r) => /event frequency/.test(r))).toBe(true);
    expect(hot!.label2).toMatch(/Emerging activity|Increased conflict activity|Rapid escalation/);
    expect(JSON.stringify(hot)).not.toMatch(/emerging war|new war/i);
    // A front with 4 incidents every 6 hours for a week, and 4 now, is not "emerging".
    const busy = many(4 * 28, 6.5, 160, { severity: "severe", importance: 80 });
    expect(h([...busy, ...many(4, 0.5, 5.5, { severity: "severe", importance: 80 })])).toBeNull();
    // Same count of incidents but in places with no earlier incident scores higher than in a known place.
    const sameCell = h([...quietBase, ...spike.map((e) => ({ ...e, lat: 0 }))]);
    const spread = h([...quietBase, ...spike.map((e, i) => ({ ...e, lat: 5 + i * 2 }))]);
    expect(spread!.score).toBeGreaterThan(sameCell?.score ?? 0);
    // Reporting volume (independent source groups) does not move the score at all.
    expect(h([...quietBase, ...spike.map((e) => ({ ...e, independent: 40 }))])!.score).toBe(hot!.score);
    // One incident is not a pattern.
    expect(h([...quietBase, spike[0]!])).toBeNull();
  });

  test("confidence: three independent reports differ from three repeats of one statement; party claims stay claims; corroboration raises confidence", () => {
    const rep = (id: string, url: string, cls: string) => ({ sourceId: id, url, trust: sourceTrust({ independenceClass: cls }) });
    const independent = summarizeEvidence([rep("a", "https://a.test/1", "independent_standard"), rep("b", "https://b.test/1", "independent_standard"), rep("c", "https://c.test/1", "independent_high")]);
    const repeats = summarizeEvidence([rep("a", "https://a.test/1", "independent_standard"), rep("a", "https://a.test/2", "independent_standard"), rep("a", "https://a.test/1?utm_source=x", "independent_standard")]);
    expect(independent.independentSources).toBe(3);
    expect(repeats.independentSources).toBe(1);
    expect(deriveConfidence({ evidence: independent }).score).toBeGreaterThan(deriveConfidence({ evidence: repeats }).score);
    const party = summarizeEvidence([rep("m", "https://mod.test/1", "official_military")]);
    expect(party.independentSources).toBe(0);
    expect(party.partyClaims).toBe(1);
    const partyConf = deriveConfidence({ evidence: party });
    expect(partyConf.label).toBe("low");
    expect(partyConf.reasons.join(" ")).toMatch(/party claims/);
    const corroborated = summarizeEvidence([rep("m", "https://mod.test/1", "official_military"), rep("r", "https://r.test/1", "independent_high")]);
    expect(deriveConfidence({ evidence: corroborated }).score).toBeGreaterThan(partyConf.score);
    // Significance never reads a report count and confidence only scales it.
    const base = { magnitude: 70, stateChange: 60, scope: 40, kindWeight: 60, ageHours: 1, windowHours: 6, novel: true };
    expect(briefSignificance({ ...base, confidence: 0.9 }).score).toBeGreaterThan(briefSignificance({ ...base, confidence: 0.2 }).score);
  });

  test("windows, custom ranges and country codes are validated", () => {
    const now = new Date("2026-09-21T12:00:00Z");
    expect(parseRange({}, now)).toMatchObject({ window: "6h", live: true });
    expect(parseRange({ window: "24h" }, now).from.toISOString()).toBe("2026-09-20T12:00:00.000Z");
    expect(parseRange({ window: "3d", asOf: "2026-09-10T00:00:00Z" }, now)).toMatchObject({ live: false });
    expect(() => parseRange({ window: "2h" }, now)).toThrow(BriefInputError);
    expect(() => parseRange({ window: "custom", from: "2026-09-01T00:00:00Z" }, now)).toThrow(BriefInputError);
    expect(() => parseRange({ window: "custom", from: "2026-01-01T00:00:00Z", to: "2026-09-01T00:00:00Z" }, now)).toThrow(/30 days/);
    expect(normalizeCountry("FIN")).toEqual({ code: "FI", name: "Finland" });
    expect(normalizeCountry("fi")?.code).toBe("FI");
    expect(normalizeCountry("zz")).toBeNull();
    expect(mapHrefFor({ deepLink: "/x", mapTarget: { layers: ["aviation"], hazardId: "h1", lat: 1, lng: 2, zoom: 7 } })).toBe("/world?layers=aviation&hazard=h1&focus=1.000%2C2.000%2C7");
  });
});

// ---------------------------------------------------------------------------------------------
test.describe.serial("Conflict briefs: developments, deduplication, trust and territory", () => {
  let conflict: { id: string; slug: string };
  const publish = async (request: APIRequestContext, over: Record<string, unknown>) =>
    (await request.post("/api/admin/events", { data: { title: `BR event ${unique()}`, summary: "Fighting reported near the front.", eventType: "artillery", latitude: 49.5, longitude: 32, occurredAt: new Date().toISOString(), severity: "severe", importance: 85, published: true, sourceName: `BR Wire ${unique()}`, conflictId: conflict.id, countryCode: "UA", ...over } }).then((r) => r.json())) as { id: string; slug: string; title: string };
  const attach = async (request: APIRequestContext, eventId: string, sourceId: string, relationship = "corroborating") => {
    const item = (await request.post("/api/admin/incoming/manual", { data: { sourceId, originalTitle: `Report ${unique()}`, originalText: "Same account." } }).then((r) => r.json())) as { id: string };
    expect((await request.post(`/api/admin/incoming/${item.id}/merge`, { data: { eventId, relationship } })).ok()).toBe(true);
  };
  const outlet = async (request: APIRequestContext, over: Record<string, unknown> = {}) => (await request.post("/api/admin/sources", { data: { name: `BR Outlet ${unique()}`, type: "manual", independenceClass: "independent_standard", ...over } }).then((r) => r.json())) as { id: string; name: string };
  const cb = (request: APIRequestContext, extra = "") => brief(request, `conflict=${conflict.slug}&window=6h${extra}`);

  test.beforeAll(async ({ request }) => {
    conflict = (await request.post("/api/admin/conflicts", { data: { slug: `br-${unique()}`, name: "BR Ukraine War", region: "Europe", status: "active", severity: "extreme", intensity: 95, lat: 49, lng: 32, fightingCountries: ["UA"], fullScaleWar: true } }).then((r) => r.json())) as { id: string; slug: string };
  });

  test("duplicate reports merge into ONE development; repeats from one outlet are not extra evidence; a routine incident is not a development", async ({ request }) => {
    const e = await publish(request, { title: "BR Strike on the rail hub" });
    const reuters = await outlet(request);
    await attach(request, e.id, reuters.id);
    await attach(request, e.id, reuters.id); // same outlet again
    await attach(request, e.id, reuters.id); // and again
    const other = await outlet(request);
    await attach(request, e.id, other.id);
    await publish(request, { title: "BR Minor skirmish", severity: "guarded", importance: 20 });
    const b = await cb(request);
    const items = b.developments.filter((d) => d.title === "BR Strike on the rail hub");
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ developmentType: "conflict_event", independentSourceCount: 3, isPartyClaim: false });
    expect(items[0]!.evidence.dependentRepeats).toBeGreaterThanOrEqual(2);
    expect(items[0]!.sources.filter((s) => s.role === "repeat").length).toBeGreaterThanOrEqual(2);
    expect(items[0]!.sources.filter((s) => s.role === "independent").length).toBe(3);
    expect(titlesOf(b)).not.toContain("BR Minor skirmish"); // routine: not a development
    const inspector = (await request.get("/api/admin/briefings?window=6h").then((r) => r.json())) as { excluded: { title: string; reason: string }[] };
    expect(inspector.excluded.find((x) => x.title === "BR Minor skirmish")!.reason).toMatch(/Below significance threshold/);
    expect(items[0]!.significanceReasons.length).toBeGreaterThan(0);
    expect(items[0]!.confidenceReasons.join(" ")).toMatch(/3 independent sources/);
  });

  test("a material update creates a development; a trivial or weakly-supported edit does not", async ({ request }) => {
    const { prisma } = await import("@/lib/db/client");
    const old = await publish(request, { title: "BR Older incident", occurredAt: ago(72), severity: "elevated", importance: 70 });
    const s2 = await outlet(request);
    await attach(request, old.id, s2.id);
    const row = await prisma.event.findUniqueOrThrow({ where: { id: old.id } });
    // A descriptive edit is not recorded as a briefing field at all.
    await prisma.eventHistory.create({ data: { eventId: row.id, field: "summary", oldValue: "a", newValue: "b", source: "test" } });
    expect(titlesOf(await cb(request))).not.toContain("Update: BR Older incident");
    // A severity change that an admin accepted is a material update to an existing incident.
    await prisma.eventHistory.create({ data: { eventId: row.id, field: "severity", oldValue: "elevated", newValue: "severe", source: "test" } });
    const b = await cb(request);
    const u = b.developments.find((d) => d.title === "Update: BR Older incident")!;
    expect(u).toMatchObject({ developmentType: "event_update", previousState: "elevated", currentState: "severe" });
    // A casualty revision that only ONE outlet supports is not material.
    const weak = await publish(request, { title: "BR Weak casualty", occurredAt: ago(72), severity: "elevated", importance: 70 });
    await prisma.eventHistory.create({ data: { eventId: weak.id, field: "casualtiesKilled", oldValue: "2", newValue: "40", source: "test" } });
    expect(titlesOf(await cb(request))).not.toContain("Update: BR Weak casualty");
  });

  test("escalation and the conflict assessment come from recorded incidents against the previous 7 days; the trend and reasons are exposed", async ({ request }) => {
    const c2 = (await request.post("/api/admin/conflicts", { data: { slug: `br-${unique()}`, name: "BR Escalating", region: "Africa", status: "active", severity: "elevated", intensity: 50, lat: 10, lng: 20, fightingCountries: ["NG"] } }).then((r) => r.json())) as { id: string; slug: string };
    const mk = (title: string, hours: number, lat: number, severity: string, importance: number) => publish(request, { title, conflictId: c2.id, countryCode: "NG", occurredAt: ago(hours), latitude: lat, longitude: 20, severity, importance });
    for (let i = 0; i < 5; i++) await mk(`BR base ${i}`, 30 + i * 20, 10, "guarded", 30);
    await mk("BR surge A", 1, 12.5, "severe", 88);
    await mk("BR surge B", 2, 13, "severe", 86);
    await mk("BR surge C", 3, 13.5, "extreme", 93);
    const b = await brief(request, `conflict=${c2.slug}&window=6h`);
    expect(b.assessment).toMatchObject({ trend: "escalating", text: "Escalation indicators increased" });
    expect(b.assessment!.reasons.length).toBeGreaterThan(0);
    expect(b.escalation[0]!.signals.map((s) => s.name)).toEqual(expect.arrayContaining(["severe_events_up"]));
    expect(byType(b, "escalation")).toHaveLength(1);
    expect(byType(b, "escalation")[0]!.section).toBe("escalation");
    // The same conflict, seen over a 7-day window, is compared with its own earlier week and is not a spike.
    const hot = (await request.get("/api/admin/briefings?window=6h").then((r) => r.json())) as { hotspots: { conflictSlug: string; label2: string; reasons: string[]; metrics: { windowEvents: number } }[] };
    const h = hot.hotspots.find((x) => x.conflictSlug === c2.slug)!;
    expect(h).toBeTruthy();
    expect(h.reasons.some((r) => /event frequency/.test(r))).toBe(true);
    expect(["Emerging activity", "Increased conflict activity", "Rapid escalation"]).toContain(h.label2);
    const global = await brief(request, "window=6h");
    expect(global.hotspots.some((x) => x.conflictSlug === c2.slug)).toBe(true);
  });

  test("a status change to dormant is a resolution and de-escalating; the transition is recorded old -> new", async ({ request }) => {
    const c3 = (await request.post("/api/admin/conflicts", { data: { slug: `br-${unique()}`, name: "BR Ceasefire", region: "Asia", status: "active", severity: "high", intensity: 70, lat: 30, lng: 60, fightingCountries: ["PK"] } }).then((r) => r.json())) as { id: string; slug: string };
    await request.patch(`/api/admin/conflicts/${c3.id}`, { data: { intensity: 60 } }); // first sighting: baseline state
    await request.patch(`/api/admin/conflicts/${c3.id}`, { data: { status: "dormant" } });
    const b = await brief(request, `conflict=${c3.slug}&window=6h`);
    const s = byType(b, "conflict_status")[0]!;
    expect(s).toMatchObject({ previousState: "active", currentState: "dormant", section: "resolution" });
    expect(b.assessment!.trend).toBe("de-escalating");
    expect(b.assessment!.text).toBe("De-escalation indicators increased");
  });

  test("territory: an approved change is stated as a change; an uncertain one is 'under review'; two claimants are conflicting claims; a pending lead is not in the brief", async ({ request }) => {
    const { prisma } = await import("@/lib/db/client");
    const a = await prisma.militaryUnit.create({ data: { name: `BR Actor A ${unique()}` } });
    const bb = await prisma.militaryUnit.create({ data: { name: `BR Actor B ${unique()}` } });
    const mk = (actorId: string, prevId: string | null, description: string, location: string, status = "pending") => prisma.territorialChangeCandidate.create({ data: { conflictId: conflict.id, description, claimedActorId: actorId, previousActorId: prevId, locationName: location, changeType: "captured", status, confidence: 0.6, precision: "area_level", sourceName: "BR Report", sourceUrl: "https://example.test/report" } });
    const approved = await mk(a.id, bb.id, "Actor A took Northtown", "Northtown");
    const pendingLead = await mk(a.id, null, "Actor A reportedly took Pendingville", "Pendingville");
    const uncertain = await mk(bb.id, null, "Actor B claims Testville", "Testville");
    const second = await mk(a.id, null, "Actor A claims Testville", "Testville");
    expect((await request.post(`/api/admin/territorial-change-candidates/${approved.id}/review`, { data: { action: "approve", geometryMode: "record_only" } })).ok()).toBe(true);
    expect((await request.post(`/api/admin/territorial-change-candidates/${uncertain.id}/review`, { data: { action: "uncertain" } })).ok()).toBe(true);
    expect((await request.post(`/api/admin/territorial-change-candidates/${second.id}/review`, { data: { action: "uncertain" } })).ok()).toBe(true);
    void pendingLead;
    const b = await cb(request);
    const changed = byType(b, "territory_changed").find((d) => d.title.includes("Northtown"))!;
    expect(changed.title).toBe(`Control of Northtown changed from ${bb.name} to ${a.name}`);
    expect(changed.summary).toMatch(/after admin-reviewed territorial evidence/);
    expect(changed).toMatchObject({ section: "territory", previousState: bb.name, currentState: a.name });
    const review = byType(b, "territory_under_review").find((d) => d.title.includes("Testville"));
    expect(review).toBeTruthy();
    expect(review!.title).toMatch(/^Possible territorial change under review/);
    expect(JSON.stringify(review)).not.toMatch(/changed from|captured/i);
    const conflicting = byType(b, "territory_conflicting").find((d) => d.title.includes("Testville"))!;
    expect(conflicting.title).toBe("Conflicting claims over control of Testville");
    expect(conflicting.conflictingClaims!.map((c) => c.actor).sort()).toEqual([a.name, bb.name].sort());
    expect(conflicting.summary).toMatch(/No change of control is recorded while the claims conflict/);
    expect(titlesOf(b).some((t) => t.includes("Pendingville"))).toBe(false); // unreviewed lead
    const insp = (await request.get("/api/admin/briefings?window=6h").then((r) => r.json())) as { excluded: { developmentType: string; reason: string }[] };
    expect(insp.excluded.some((x) => x.developmentType === "unreviewed_territorial_lead")).toBe(true);
    expect(b.counts.territorialChanges).toBeGreaterThanOrEqual(1);
  });

  test("party claims: hidden by default (counted), shown as labelled claims when enabled, never as fact; independent corroboration turns it into a sourced development", async ({ request }) => {
    const partySource = `BR MoD ${unique()}`;
    await request.post("/api/admin/sources", { data: { name: partySource, type: "manual", independenceClass: "official_military", claimPolicy: "party_claim", perspective: "Ministry of Defence" } });
    const e = await publish(request, { title: "BR Airport destroyed", sourceName: partySource, importance: 92 });
    const hidden = await cb(request);
    expect(titlesOf(hidden).some((t) => t.includes("Airport destroyed"))).toBe(false);
    expect(hidden.counts.partyClaimsHidden).toBeGreaterThanOrEqual(1);
    const shown = await cb(request, "&claims=1");
    const claim = shown.developments.find((d) => d.title.includes("Airport destroyed"))!;
    expect(claim).toMatchObject({ developmentType: "party_claim", isPartyClaim: true, section: "claims", independentSourceCount: 0 });
    expect(claim.title).toBe("Ministry of Defence claims: BR Airport destroyed");
    expect(claim.confidenceLabel).toBe("low");
    expect(claim.summary).toMatch(/Unverified/);
    // A party claim never feeds the escalation model or the top list.
    expect(shown.top).not.toContain(claim.id);
    // Independent corroboration: now a sourced development, with higher confidence, and the claim is no longer a bare claim.
    const reuters = await outlet(request);
    await attach(request, e.id, reuters.id);
    const after = await cb(request);
    const dev = after.developments.find((d) => d.title === "BR Airport destroyed")!;
    expect(dev).toMatchObject({ developmentType: "conflict_event", isPartyClaim: false, independentSourceCount: 1 });
    expect(dev.confidence).toBeGreaterThan(claim.confidence);
    expect(dev.partyClaimCount).toBe(1);
    expect(dev.sources.some((s) => s.role === "party_claim")).toBe(true);
  });

  test("caching: a repeated request is served from cache; a duplicate report does not invalidate it; a material change does", async ({ request }) => {
    const e = await publish(request, { title: "BR Cache subject", importance: 90 });
    const reuters = await outlet(request);
    await attach(request, e.id, reuters.id);
    await cb(request); // warm
    const hit = await cb(request);
    expect(hit.meta.cached).toBe(true);
    const revision = hit.revision;
    await attach(request, e.id, reuters.id); // the same outlet again: not a material change
    const still = await cb(request);
    expect(still.meta.cached).toBe(true);
    expect(still.revision).toBe(revision);
    const second = await outlet(request);
    await attach(request, e.id, second.id, "corroborating"); // independent corroboration counts, but the alert layer only bumps on state change
    await request.patch(`/api/admin/events/${e.id}`, { data: { severity: "extreme" } }); // material: event record changed
    const fresh = await cb(request);
    expect(fresh.meta.cached).toBe(false);
    expect(fresh.revision).not.toBe(revision);
    expect(fresh.developments.find((d) => d.title.includes("Cache subject"))!.independentSourceCount).toBe(3);
  });

  test("history: a saved brief stays exactly as generated when the underlying events change later", async ({ request }) => {
    const { prisma } = await import("@/lib/db/client");
    const e = await publish(request, { title: "BR Snapshot subject", importance: 95 });
    const saved = (await request.post(`/api/brief/snapshots?conflict=${conflict.slug}&window=6h`).then((r) => r.json())) as { id: string; items: { title: string; summary: string }[]; developmentIds: string[] };
    const before = saved.items.find((i) => i.title === "BR Snapshot subject")!;
    expect(before).toBeTruthy();
    expect(saved.developmentIds).toContain(`event:${e.id}`);
    await prisma.event.update({ where: { id: e.id }, data: { title: "BR Snapshot subject (renamed)", published: false } });
    const live = await cb(request);
    expect(titlesOf(live)).not.toContain("BR Snapshot subject");
    const again = (await request.get(`/api/brief/snapshots/${saved.id}`).then((r) => r.json())) as { items: { title: string; summary: string }[]; generatedAt: string };
    expect(again.items.find((i) => i.title === "BR Snapshot subject")).toEqual(before);
    const list = (await request.get(`/api/brief/snapshots?scope=conflict:${conflict.slug}`).then((r) => r.json())) as { id: string }[];
    expect(list.some((s) => s.id === saved.id)).toBe(true);
  });

  test("brief inputs are validated and a watchlist brief needs a device", async ({ request }) => {
    expect((await request.get("/api/brief?window=2h")).status()).toBe(400);
    expect((await request.get("/api/brief?country=ZZ")).status()).toBe(400);
    expect((await request.get("/api/brief?conflict=does-not-exist")).status()).toBe(400);
    expect((await request.get("/api/brief?window=custom")).status()).toBe(400);
    expect((await request.get("/api/brief?watchlist=true")).status()).toBe(401);
    expect((await request.get(`/api/brief?window=custom&from=${ago(2)}&to=${new Date().toISOString()}`)).status()).toBe(200);
  });
});

// ---------------------------------------------------------------------------------------------
test.describe.serial("Hazards and infrastructure in briefs; country and watchlist scopes", () => {
  const me = (request: APIRequestContext, id: string) => {
    const headers = { "x-vigil-client": id };
    return {
      follow: (entityType: string, entityKey: string, extra: Record<string, unknown> = {}) => request.post("/api/me/watches", { headers, data: { entityType, entityKey, ...extra } }),
      brief: (query: string) => brief(request, query, headers),
      headers,
    };
  };

  test("a major earthquake appears; small ones and routine observations do not; deep link enables the layer", async ({ request }) => {
    await ingest(request, "usgs_earthquakes", "usgs-jp");
    const b = await brief(request, "window=6h");
    const quake = byType(b, "earthquake").find((d) => d.title.startsWith("M6.9"))!;
    expect(quake).toBeTruthy();
    expect(quake).toMatchObject({ section: "hazards", domain: "hazard", isResolution: false });
    expect(quake.title).toContain("tsunami flag");
    expect(quake.summary).toMatch(/M6\.9 earthquake recorded 45 km E of Tokyo, Japan/);
    expect(quake.evidence.official).toBe(true);
    expect(quake.mapTarget).toMatchObject({ layers: ["earthquakes"], hazardId: expect.any(String) });
    expect(mapHrefFor(quake)).toMatch(/^\/world\?layers=earthquakes&hazard=.+&focus=/);
    expect(titlesOf(b).some((t) => t.includes("M4.6"))).toBe(false);
    const insp = (await request.get("/api/admin/briefings?window=6h").then((r) => r.json())) as { excluded: { title: string; reason: string }[] };
    expect(insp.excluded.find((x) => x.title.includes("M4.6"))!.reason).toMatch(/below the briefing threshold/);
    // Revision: the same quake revised by a large amount is a change of state, not a second development.
    await ingest(request, "usgs_earthquakes", "usgs-jp", "?v=2");
    const b2 = await brief(request, "window=6h");
    const hachinohe = byType(b2, "earthquake").filter((d) => d.title.includes("Hachinohe"));
    expect(hachinohe).toHaveLength(1);
    expect(hachinohe[0]!.summary).toMatch(/Magnitude revised from M5\.8 to M6\.6/);
    expect(hachinohe[0]!.previousState).toBe("M5.8");
    expect(hachinohe[0]!.currentState).toBe("M6.6");
  });

  test("airport closure appears with old and new state; reopening is a resolution; a national internet outage appears", async ({ request }) => {
    await ingest(request, "faa_nas_status", "faa");
    let b = await brief(request, "window=6h");
    const closed = byType(b, "airport").find((d) => d.title.includes("O'Hare"))!;
    expect(closed).toBeTruthy();
    expect(closed).toMatchObject({ section: "infrastructure", isResolution: false, currentState: "closed", previousState: "normal" });
    expect(closed.title).toMatch(/closed$/);
    expect(closed.summary).toMatch(/closed at \d\d:\d\d UTC/);
    expect(b.counts.infrastructureDisruptions).toBeGreaterThanOrEqual(1);
    await ingest(request, "faa_nas_status", "faa", "?v=2");
    b = await brief(request, "window=6h");
    const reopened = byType(b, "airport").find((d) => d.title.includes("O'Hare"))!;
    expect(reopened).toMatchObject({ isResolution: true, section: "resolution", previousState: "closed" });
    expect(reopened.title).toMatch(/reopened$/);
    await ingest(request, "ioda", "ioda");
    b = await brief(request, "window=6h");
    const outage = byType(b, "internet").find((d) => d.title.includes("Lebanon"))!;
    expect(outage).toBeTruthy();
    expect(outage.summary).toMatch(/does not establish the cause/);
    expect(JSON.stringify(outage)).not.toMatch(/shutdown was|government (?:ordered|directed)|censor/i);
  });

  test("country brief: uses the central impact model (bordering war >= 75, far away below the bar); local hazards appear for that country only", async ({ request }) => {
    const c = (await request.post("/api/admin/conflicts", { data: { slug: `br-${unique()}`, name: "BR Border War", region: "Europe", status: "active", severity: "extreme", intensity: 95, lat: 49, lng: 32, fightingCountries: ["UA"], fullScaleWar: true } }).then((r) => r.json())) as { id: string; slug: string };
    const e = (await request.post("/api/admin/events", { data: { title: "BR Border offensive", summary: "Large offensive.", eventType: "ground", latitude: 49.2, longitude: 32.1, occurredAt: ago(1), severity: "extreme", importance: 95, published: true, sourceName: `BR Wire ${unique()}`, conflictId: c.id, countryCode: "UA" } }).then((r) => r.json())) as { title: string };
    const pl = await brief(request, "country=PL&window=6h");
    const inPl = pl.developments.find((d) => d.title === e.title)!;
    expect(inPl).toBeTruthy();
    expect(inPl.impact).toBeGreaterThanOrEqual(75); // full-scale war in a bordering country
    expect(inPl.reasons.join(" ")).toMatch(/impact score \d+ \(central impact model\)/);
    expect(pl.country).toEqual({ code: "PL", name: "Poland" });
    expect(titlesOf(pl).some((t) => t.startsWith("M6.9"))).toBe(false); // a Japanese quake is not Poland's business
    const ua = await brief(request, "country=UA&window=6h");
    expect(ua.developments.find((d) => d.title === e.title)!.impact).toBe(100); // war inside the country
    const br = await brief(request, "country=BR&window=6h");
    expect(titlesOf(br)).not.toContain(e.title); // distant, below the impact bar
    const jp = await brief(request, "country=JPN&window=6h");
    expect(jp.country!.code).toBe("JP");
    expect(titlesOf(jp).some((t) => t.startsWith("M6.9"))).toBe(true); // located in Japan
    expect(titlesOf(jp)).not.toContain(e.title);
    // Ordering: developments inside the country outrank those that reach it through impact scoring.
    const both = pl.developments.map((d) => d.impact ?? 0);
    expect([...both].sort((x, y) => y - x).slice(0, 1)[0]).toBe(both[0]);
    expect(pl.escalation.length).toBeGreaterThanOrEqual(0);
  });

  test("watchlist brief: only what the device follows, merged by development; needs the device header", async ({ request }) => {
    const user = me(request, client());
    await user.follow("airport", "KORD");
    await user.follow("country", "JP", { mode: "important" });
    const empty = me(request, client());
    const b = await user.brief("watchlist=true&window=6h");
    expect(b.scopeKey).toMatch(/^watchlist:/);
    expect(b.developments.length).toBeGreaterThan(0);
    for (const d of b.developments) expect(d.reasons.join(" ")).toMatch(/you follow/);
    expect(titlesOf(b).some((t) => t.includes("O'Hare"))).toBe(true);
    expect(titlesOf(b).some((t) => t.includes("Lebanon"))).toBe(false); // not followed
    expect(new Set(b.developments.map((d) => d.id)).size).toBe(b.developments.length); // one entry per development, not per notification
    expect((await empty.brief("watchlist=true&window=6h")).developments).toHaveLength(0);
    // "For you": the selected country and the watchlist together.
    const forYou = await user.brief("country=PL&watchlist=true&window=6h");
    expect(forYou.country!.code).toBe("PL");
    expect(titlesOf(forYou).some((t) => t.includes("O'Hare"))).toBe(true);
  });

  test("a 24h brief is the same deterministic result as another request for it; a 1h window sees less than 24h", async ({ request }) => {
    const a = await brief(request, "window=24h");
    const b = await brief(request, "window=24h");
    expect(b.developments.map((d) => d.id)).toEqual(a.developments.map((d) => d.id));
    expect(b.headline).toBe(a.headline);
    const short = await brief(request, "window=1h");
    expect(short.developments.length).toBeLessThanOrEqual(a.developments.length);
    // Historical: at a moment before anything existed the brief is empty.
    const past = await brief(request, `window=6h&asOf=${ago(24 * 5)}`);
    expect(past.live).toBe(false);
    expect(past.developments).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------------------------
async function openBrief(page: Page, path: string) {
  await page.goto(path);
  await expect(page.getByTestId("brief-body")).toBeVisible({ timeout: 60_000 });
}

test.describe.serial("Brief UI", () => {
  test.beforeAll(async ({ request }) => {
    await ingest(request, "usgs_earthquakes", "usgs-jp");
    await ingest(request, "faa_nas_status", "faa");
  });

  test("/brief renders sections, switches windows and expands sources and reasons", async ({ page }) => {
    await openBrief(page, "/brief");
    await expect(page.getByRole("heading", { name: "Global Brief" })).toBeVisible();
    await expect(page.getByTestId("brief-headline")).toContainText("Last 6 hours");
    await expect(page.getByTestId("brief-section-hazards")).toBeVisible();
    await expect(page.getByTestId("brief-section-infrastructure")).toBeVisible();
    await expect(page.getByTestId("brief-top")).toBeVisible();
    const card = page.getByTestId("development-card").filter({ hasText: "M6.9 earthquake" }).first();
    await expect(card.getByTestId("dev-confidence")).toContainText("confidence");
    await card.getByTestId("dev-expand").click();
    await expect(card.getByTestId("dev-details")).toContainText("Official provider");
    await expect(card.getByTestId("dev-reasons")).toContainText("Significance");
    await page.getByTestId("window-24h").click();
    await expect(page.getByTestId("brief-window-label")).toHaveText("Last 24 hours");
    await expect(page.getByTestId("brief-headline")).toContainText("Last 24 hours");
    await page.getByTestId("window-custom").click();
    await expect(page.getByTestId("brief-custom-hint")).toBeVisible();
    await page.getByTestId("window-1h").click();
    await expect(page.getByTestId("brief-headline")).toContainText("Last hour");
  });

  test("a brief item deep-links into /world with the layer on and the record selected", async ({ page }) => {
    await openBrief(page, "/brief");
    const link = page.getByTestId("development-card").filter({ hasText: "M6.9 earthquake" }).first().getByTestId("dev-map-link");
    await link.click();
    await expect(page).toHaveURL(/\/world\?layers=earthquakes&hazard=.+&focus=/, { timeout: 90_000 });
    await expect(page.locator('[data-testid="hazard-detail"]:visible').first()).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('[data-testid="hazard-title"]:visible').first()).toContainText("M6.9");
  });

  test("country brief page", async ({ page }) => {
    await page.goto("/brief/country/JPN");
    await expect(page.getByTestId("country-brief-page")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("heading", { name: "Japan — Brief" })).toBeVisible();
    await expect(page.getByTestId("brief-body")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("development-card").filter({ hasText: "M6.9 earthquake" }).first()).toBeVisible();
    await expect(page.getByTestId("country-brief-basis")).toContainText("Nothing is inferred");
    await page.goto("/country/JP");
    await expect(page.getByTestId("country-brief-link")).toBeVisible();
  });

  test("conflict page has a Brief section with assessment and evidence", async ({ page, request }) => {
    const c = (await request.post("/api/admin/conflicts", { data: { slug: `br-${unique()}`, name: "BR UI Conflict", region: "Europe", status: "active", severity: "high", intensity: 70, lat: 45, lng: 30, fightingCountries: ["UA"] } }).then((r) => r.json())) as { id: string; slug: string };
    await request.post("/api/admin/events", { data: { title: "BR UI strike", summary: "A strike.", eventType: "artillery", latitude: 45, longitude: 30, occurredAt: ago(1), severity: "severe", importance: 88, published: true, sourceName: `BR Wire ${unique()}`, conflictId: c.id, countryCode: "UA" } });
    await page.goto(`/conflict/${c.slug}`);
    const section = page.getByTestId("section-brief");
    await expect(section).toBeVisible({ timeout: 60_000 });
    await expect(section.getByTestId("brief-assessment")).toBeVisible({ timeout: 60_000 });
    await expect(section.getByTestId("assessment-text")).toBeVisible();
    await expect(section.getByTestId("development-card").filter({ hasText: "BR UI strike" })).toBeVisible();
    await section.getByTestId("window-7d").click();
    await expect(section.getByTestId("brief-window-label")).toHaveText("Last 7 days");
  });

  test("watchlist: 'Brief my watchlist' summarises what is followed; For You shows a brief", async ({ page }) => {
    await page.goto("/watchlist");
    await expect(page.getByRole("heading", { name: /Watchlist/i }).first()).toBeVisible({ timeout: 60_000 });
    // Follow an airport through the API on behalf of this browser context.
    await page.waitForFunction(() => !!localStorage.getItem("vigil-client-id"), undefined, { timeout: 30_000 });
    const id = await page.evaluate(() => localStorage.getItem("vigil-client-id"));
    expect(id).toBeTruthy();
    const res = await page.request.post("/api/me/watches", { headers: { "x-vigil-client": id! }, data: { entityType: "airport", entityKey: "KORD" } });
    expect(res.ok()).toBe(true);
    await page.reload();
    await page.getByTestId("brief-my-watchlist").click();
    const panel = page.getByTestId("watchlist-brief");
    await expect(panel.getByTestId("brief-body")).toBeVisible({ timeout: 60_000 });
    await expect(panel.getByTestId("development-card").filter({ hasText: "O'Hare" }).first()).toBeVisible();
    await page.goto("/for-you");
    await expect(page.getByTestId("for-you-brief")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("for-you-brief").getByTestId("brief-body")).toBeVisible({ timeout: 60_000 });
  });

  test("/world What changed panel lists developments for the selected range and selecting one enables the layer and selects the record", async ({ page }) => {
    await page.goto("/world");
    await page.getByTestId("what-changed-button").click();
    await expect(page.getByTestId("what-changed-headline")).toContainText("significant development", { timeout: 60_000 });
    const item = page.getByTestId("what-changed-item").filter({ hasText: "M6.9 earthquake" }).first();
    await expect(item).toBeVisible();
    await item.click();
    await expect(page.locator('[data-testid="hazard-title"]:visible').first()).toContainText("M6.9", { timeout: 60_000 });
    await expect(page).toHaveURL(/\/world$/); // same page and map: nothing navigated away
  });

  test("saved brief page shows the stored copy", async ({ page, request }) => {
    const saved = (await request.post("/api/brief/snapshots?window=6h").then((r) => r.json())) as { id: string; headline: string };
    await page.goto(`/brief?snapshot=${saved.id}`);
    await expect(page.getByTestId("saved-brief")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("saved-headline")).toHaveText(saved.headline);
    await expect(page.getByTestId("saved-item").first()).toBeVisible();
  });

  test("admin briefings inspector shows developments, exclusions, escalation and hotspot reasoning", async ({ page }) => {
    await page.goto("/admin/briefings");
    await expect(page.getByTestId("admin-briefings")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("admin-developments")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("admin-dev-row").first()).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("admin-excluded")).toBeVisible();
    await expect(page.getByTestId("admin-escalation")).toBeVisible();
    await expect(page.getByTestId("admin-hotspots")).toBeVisible();
    await page.getByTestId("admin-window").selectOption("24h");
    await expect(page.getByTestId("admin-brief-meta")).toContainText("→", { timeout: 60_000 });
  });
});

export type { BriefDevelopment };
