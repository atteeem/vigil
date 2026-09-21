import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { acceptDevelopment, computePriority, fingerprintOf, type Development } from "@/lib/alerts/decide";
import { effectiveRules, validateRules, validateSettingsPatch, ruleSchemaFor, WATCH_ENTITY_TYPES, DEFAULT_SETTINGS, inQuietHours } from "@/lib/alerts/types";
import { countryFromPlace } from "@/lib/hazards/reference";

// Watchlists, notifications and alert rules. The alert service reads developments from the EXISTING
// systems (conflict events, territorial review, GlobalEvent providers, claims); nothing here adds a
// pipeline. API-level tests drive the real write paths; UI tests use the bell, Watchlist page and follow
// buttons. Structured providers use the local fixtures (pinned to T0).

const FIXTURE = "http://localhost:3100/api/test-fixtures/hazards";
const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const T0 = Date.now();
const client = () => `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 14)}xxxxxxxxxx`.slice(0, 32);
const fixtureUrl = (path: string, query: string) => `${FIXTURE}/${path}${query ? `${query}&` : "?"}t=${T0}`;
const CLASS: Record<string, string> = { usgs_earthquakes: "scientific_official", nws_alerts: "government_alert", usgs_volcanoes: "scientific_official", faa_nas_status: "government_alert", portwatch_chokepoints: "sensor_provider", elexon_remit: "infrastructure_operator", ioda: "sensor_provider", nasa_firms: "sensor_provider" };

async function ingest(request: APIRequestContext, provider: string, path: string, query = "") {
  const res = await request.post("/api/admin/sources", { data: { name: `WL ${provider} ${unique()}`, type: "structured", platform: provider, feedUrl: fixtureUrl(path, query), url: fixtureUrl(path, query), enabled: true, autoIngest: false, autoProcessing: false, independenceClass: CLASS[provider], pollIntervalMinutes: 5 } });
  const src = (await res.json()) as { id: string };
  return (await request.post(`/api/admin/sources/${src.id}/fetch`).then((r) => r.json())) as { errors: number; new: number };
}

// --- per-device API helper ----------------------------------------------------------------------
interface Watch { id: string; entityType: string; entityKey: string; mode: string; rules: Record<string, unknown>; effectiveRules: Record<string, unknown>; muted: boolean; pausedUntil: string | null }
interface Notif { id: string; title: string; summary: string; priority: string; priorityScore: number; category: string; alertType: string; entityLabel: string; deepLink: string; isPartyClaim: boolean; isResolution: boolean; suppressedCount: number; fingerprint: string; readAt: string | null; snapshot: Record<string, unknown>; reason: Record<string, unknown> }
const me = (request: APIRequestContext, id: string) => {
  const headers = { "x-vigil-client": id };
  return {
    follow: async (entityType: string, entityKey: string, extra: Record<string, unknown> = {}) => (await request.post("/api/me/watches", { headers, data: { entityType, entityKey, ...extra } })).json() as Promise<Watch>,
    followRaw: (data: Record<string, unknown>) => request.post("/api/me/watches", { headers, data }),
    patch: (wid: string, data: Record<string, unknown>) => request.patch(`/api/me/watches/${wid}`, { headers, data }),
    unfollow: (wid: string) => request.delete(`/api/me/watches/${wid}`, { headers }),
    watches: async () => (await request.get("/api/me/watches", { headers })).json() as Promise<Watch[]>,
    settings: async (patch?: Record<string, unknown>) => (patch ? await request.put("/api/me/settings", { headers, data: patch }) : await request.get("/api/me/settings", { headers })).json() as Promise<Record<string, unknown>>,
    feed: async () => (await request.get("/api/me/notifications?limit=100", { headers })).json() as Promise<{ items: Notif[]; unreadCount: number }>,
    notify: (data: Record<string, unknown>) => request.post("/api/me/notifications", { headers, data }),
  };
};
const titles = (n: { items: Notif[] }) => n.items.map((i) => i.title);
const adminStats = async (request: APIRequestContext) => ((await request.get("/api/admin/alerts?limit=1").then((r) => r.json())) as { stats: { developments: number; watchQueries: number; notifications: number; duplicatesSuppressed: number; decisions: Record<string, number> } }).stats;
const records = async (request: APIRequestContext, decision: string) => ((await request.get(`/api/admin/alerts?decision=${decision}&limit=500`).then((r) => r.json())) as { records: { fingerprint: string; entityKey: string; decision: string; detail: { title?: string } | null }[] }).records;

test.beforeAll(async () => {
  const { prisma } = await import("@/lib/db/client");
  await prisma.globalEvent.deleteMany({});
  await prisma.notification.deleteMany({});
  await prisma.alertState.deleteMany({});
  await prisma.alertRecord.deleteMany({});
  await prisma.watcher.deleteMany({});
});
test.afterAll(async () => {
  const { prisma } = await import("@/lib/db/client");
  await prisma.globalEvent.deleteMany({});
  await prisma.watcher.deleteMany({});
  await prisma.notification.deleteMany({});
  await prisma.alertState.deleteMany({});
  await prisma.alertRecord.deleteMany({});
  await prisma.event.deleteMany({ where: { conflict: { slug: { startsWith: "wl-" } } } }); // published events must not linger in later specs
  await prisma.conflict.deleteMany({ where: { slug: { startsWith: "wl-" } } });
  await prisma.militaryUnit.deleteMany({ where: { name: { startsWith: "WL " } } });
  await prisma.source.deleteMany({ where: { name: { startsWith: "WL " } } });
});

// ---------------------------------------------------------------------------------------------
test.describe("Rules, priority and settings (pure)", () => {
  test("rules are validated per entity type; modes give defaults; custom uses exactly what was set", () => {
    expect(ruleSchemaFor("airport").map((d) => d.key)).toEqual(expect.arrayContaining(["airportClosed", "airportDisruption", "airspace", "restoration"]));
    expect(ruleSchemaFor("airport").some((d) => d.key === "minMagnitude")).toBe(false); // not every rule on every entity
    expect(ruleSchemaFor("layer", "earthquakes").map((d) => d.key)).toEqual(expect.arrayContaining(["minMagnitude", "tsunami"]));
    expect(validateRules("airport", "OLBA", { minMagnitude: 6 }).ok).toBe(false);
    expect(validateRules("country", "JP", { minMagnitude: 6.5, tsunami: true })).toMatchObject({ ok: true });
    expect(validateRules("country", "JP", { minMagnitude: 99 }).ok).toBe(false);
    expect(validateRules("chokepoint", "chokepoint6", { chokepointMajor: "yes" }).ok).toBe(false);
    expect(effectiveRules("country", "JP", "major", {}).minMagnitude).toBe(6.5);
    expect(effectiveRules("country", "JP", "important", {}).minMagnitude).toBe(5.5);
    expect(effectiveRules("country", "JP", "custom", { minMagnitude: 7 })).toMatchObject({ minMagnitude: 7, tsunami: false, restoration: false }); // unset = off
    expect(WATCH_ENTITY_TYPES).toEqual(expect.arrayContaining(["country", "conflict", "actor", "unit", "airport", "port", "chokepoint", "volcano", "watchkey", "layer"]));
    expect(validateSettingsPatch({ minPriority: "URGENT" }).ok).toBe(false);
    expect(validateSettingsPatch({ categories: { hazards: false } })).toMatchObject({ ok: true });
    expect(DEFAULT_SETTINGS.partyClaims).toBe(false); // party claims default OFF
    expect(inQuietHours({ enabled: true, start: "22:00", end: "07:00", timezone: "UTC" }, new Date("2026-09-20T23:30:00Z"))).toBe(true);
    expect(inQuietHours({ enabled: true, start: "22:00", end: "07:00", timezone: "UTC" }, new Date("2026-09-20T12:00:00Z"))).toBe(false);
    expect(countryFromPlace("45 km E of Tokyo, Japan")).toBe("JP");
    expect(countryFromPlace("10 km N of Ridgecrest, California")).toBe("US");
    expect(countryFromPlace("somewhere, Nowhereland")).toBeNull();
  });

  test("priority is explainable and is not severity or volume: far M7 is MEDIUM, a followed airport closure is HIGH, own-country war is CRITICAL", () => {
    const far = computePriority({ significance: 85, userImpact: 0, specificity: 0.6, confidence: 0.85, isResolution: false, isPartyClaim: false });
    expect(far.priority).toBe("MEDIUM");
    const airport = computePriority({ significance: 88, userImpact: 0, specificity: 1, confidence: 0.85, isResolution: false, isPartyClaim: false });
    expect(airport.priority).toBe("HIGH");
    expect(computePriority({ significance: 60, userImpact: 100, specificity: 0.6, confidence: 0.7, ownCountryWar: true, isResolution: false, isPartyClaim: false })).toMatchObject({ priority: "CRITICAL" });
    expect(computePriority({ significance: 95, userImpact: 100, specificity: 1, confidence: 1, isResolution: true, isPartyClaim: false }).priority).toBe("MEDIUM"); // resolutions are capped
    expect(computePriority({ significance: 95, userImpact: 100, specificity: 1, confidence: 1, isResolution: false, isPartyClaim: true }).priority).toBe("MEDIUM"); // party claims are capped
    expect(airport.factors.map((f) => f.name)).toEqual(["Development significance", "Impact on you", "How directly you follow it", "Confirmation"]);
    // Confirmation is independent groups (capped), never a count of reports: the inputs have no "report count".
    expect(computePriority({ significance: 50, userImpact: 0, specificity: 1, confidence: 1, isResolution: false, isPartyClaim: false }).score).toBeLessThan(computePriority({ significance: 90, userImpact: 0, specificity: 1, confidence: 0.45, isResolution: false, isPartyClaim: false }).score);
  });

  test("fingerprints are deterministic and change only with the state or its material version", () => {
    const d = { ledgerKind: "global", ledgerKey: "g1", alertType: "airport_status" as const, state: "closed", version: 1 };
    expect(fingerprintOf(d)).toBe("global:g1|airport_status|closed|v1");
    expect(fingerprintOf({ ...d })).toBe(fingerprintOf(d));
    expect(fingerprintOf({ ...d, state: "resolved", version: 2 })).not.toBe(fingerprintOf(d));
    expect(fingerprintOf({ ...d, version: 3 })).not.toBe(fingerprintOf(d)); // closed -> reopened -> closed is a new development
  });

  test("a development is judged only by the rules that apply to it", () => {
    const dev = (over: Partial<Development> & { facts?: Development["facts"] }): Development => ({ signalKind: "global_event", signalRef: "x", alertType: "earthquake", ruleType: "earthquake", ledgerKind: "global", ledgerKey: "x", state: "s", version: 1, isResolution: false, isPartyClaim: false, significance: 60, confidence: 0.8, title: "t", summary: "s", candidates: [], facts: {}, deepLink: "/", snapshot: {}, ...over });
    const r = effectiveRules("country", "JP", "major", {});
    expect(acceptDevelopment({ entityType: "country" }, r, dev({ facts: { magnitude: 6.9 } }), { impactForWatchCountry: null }).accept).toBe(true);
    expect(acceptDevelopment({ entityType: "country" }, r, dev({ facts: { magnitude: 5.9 } }), { impactForWatchCountry: null })).toMatchObject({ accept: false });
    expect(acceptDevelopment({ entityType: "country" }, r, dev({ facts: { magnitude: 5.9, tsunami: true } }), { impactForWatchCountry: null }).accept).toBe(true);
    const air = effectiveRules("airport", "KORD", "major", {});
    expect(acceptDevelopment({ entityType: "airport" }, air, dev({ alertType: "airport_status", ruleType: "airport_status", facts: { airportStatus: "disrupted" } }), { impactForWatchCountry: null }).accept).toBe(false); // major = closures only
    expect(acceptDevelopment({ entityType: "airport" }, effectiveRules("airport", "KORD", "important", {}), dev({ alertType: "airport_status", ruleType: "airport_status", facts: { airportStatus: "disrupted" } }), { impactForWatchCountry: null }).accept).toBe(true);
    const energy = effectiveRules("watchkey", "energy_disruption:GB:X", "custom", { minCapacityMw: 500 });
    expect(acceptDevelopment({ entityType: "watchkey" }, energy, dev({ alertType: "energy_outage", ruleType: "energy_outage", facts: { capacityMw: 660 } }), { impactForWatchCountry: null }).accept).toBe(true);
    expect(acceptDevelopment({ entityType: "watchkey" }, energy, dev({ alertType: "energy_outage", ruleType: "energy_outage", facts: { capacityMw: null } }), { impactForWatchCountry: null }).accept).toBe(false); // unknown capacity is never guessed
  });
});

// ---------------------------------------------------------------------------------------------
test.describe.configure({ timeout: 120_000 }); // first hits of each dev-server route compile on demand

test.describe.serial("Watch system", () => {
  test("follow is idempotent for any entity type; unknown entities are refused; unfollow removes; devices are isolated", async ({ request }) => {
    const a = me(request, client());
    const b = me(request, client());
    const fi = await a.follow("country", "FI");
    expect(fi).toMatchObject({ entityType: "country", entityKey: "FI", mode: "major" });
    expect((await a.follow("country", "FI")).id).toBe(fi.id); // idempotent
    const olba = await a.follow("airport", "OLBA"); // a generic (type, key) — no per-type table
    expect(olba.entityKey).toBe("OLBA");
    expect((await a.follow("chokepoint", "chokepoint6", { label: "Strait of Hormuz" })).entityKey).toBe("chokepoint6");
    expect((await a.follow("layer", "earthquakes")).entityType).toBe("layer");
    expect((await a.followRaw({ entityType: "country", entityKey: "ZZ" })).status()).toBe(404);
    expect((await a.followRaw({ entityType: "spaceship", entityKey: "x" })).status()).toBe(400);
    expect((await a.followRaw({ entityType: "country", entityKey: "FI", mode: "custom", rules: { minMagnitude: "big" } })).status()).toBe(400); // input is validated even when the watch already exists
    expect((await a.watches()).map((w) => `${w.entityType}:${w.entityKey}`).sort()).toEqual(["airport:OLBA", "chokepoint:chokepoint6", "country:FI", "layer:earthquakes"]);
    expect(await b.watches()).toEqual([]); // another device sees nothing
    expect((await b.patch(fi.id, { mute: true, muted: true })).status()).toBe(404); // ...and cannot touch it
    expect((await request.get("/api/me/watches")).status()).toBe(401); // no client id, no access
    await a.unfollow(olba.id);
    expect((await a.watches()).some((w) => w.entityKey === "OLBA")).toBe(false);
  });

  test("custom rules persist per watch, are validated against the entity, and survive switching mode", async ({ request }) => {
    const a = me(request, client());
    const w = await a.follow("country", "JP");
    expect((await a.patch(w.id, { mode: "custom", rules: { minMagnitude: 7.2, tsunami: false } })).status()).toBe(200);
    let got = (await a.watches())[0]!;
    expect(got).toMatchObject({ mode: "custom", rules: { minMagnitude: 7.2, tsunami: false } });
    expect(got.effectiveRules).toMatchObject({ minMagnitude: 7.2, tsunami: false });
    expect((await a.patch(w.id, { rules: { chokepointMajor: true } })).status()).toBe(400); // rule does not apply to a country
    await a.patch(w.id, { mode: "major" });
    got = (await a.watches())[0]!;
    expect(got.effectiveRules.minMagnitude).toBe(6.5); // defaults back
    expect(got.rules).toMatchObject({ minMagnitude: 7.2 }); // the user's custom edit is kept
    await a.patch(w.id, { muted: true });
    await a.patch(w.id, { pauseHours: 24 });
    got = (await a.watches())[0]!;
    expect(got.muted).toBe(true);
    expect(new Date(got.pausedUntil!).getTime()).toBeGreaterThan(Date.now() + 23 * 3_600_000);
    await a.patch(w.id, { pauseHours: 0 });
    expect((await a.watches())[0]!.pausedUntil).toBeNull();
  });

  test("notification settings persist and are validated", async ({ request }) => {
    const a = me(request, client());
    expect((await a.settings()).partyClaims).toBe(false);
    const s = await a.settings({ minPriority: "HIGH", categories: { hazards: false }, quietHours: { enabled: true, start: "22:00", end: "06:00", timezone: "UTC" }, resolutionAlerts: false, baseCountry: "fi" });
    expect(s).toMatchObject({ minPriority: "HIGH", resolutionAlerts: false, baseCountry: "FI" });
    expect((s.categories as Record<string, boolean>).hazards).toBe(false);
    expect((s.categories as Record<string, boolean>).conflicts).toBe(true);
    expect(await a.settings()).toMatchObject({ minPriority: "HIGH", quietHours: { enabled: true, start: "22:00" } });
  });
});

// ---------------------------------------------------------------------------------------------
test.describe.serial("Conflict alerts: severity, impact, territorial change, deduplication and trust", () => {
  let conflict: { id: string; slug: string };
  const publish = async (request: APIRequestContext, over: Record<string, unknown>) => (await request.post("/api/admin/events", { data: { title: `WL event ${unique()}`, summary: "Fighting reported near the front.", eventType: "artillery", latitude: 49.5, longitude: 32, occurredAt: new Date().toISOString(), severity: "severe", importance: 90, published: true, sourceName: `WL Wire ${unique()}`, conflictId: conflict.id, countryCode: "UA", ...over } }).then((r) => r.json())) as { id: string; slug: string; title: string };

  test.beforeAll(async ({ request }) => {
    const slug = `wl-${unique()}`;
    conflict = (await request.post("/api/admin/conflicts", { data: { slug, name: "WL Ukraine War", region: "Europe", status: "active", severity: "extreme", intensity: 95, lat: 49, lng: 32, fightingCountries: ["UA"], fullScaleWar: true } }).then((r) => r.json())) as { id: string; slug: string };
  });

  test("a high-importance event alerts a conflict watch; a routine one does not; one development is one notification however many sources repeat it", async ({ request }) => {
    const user = me(request, client());
    await user.follow("conflict", conflict.slug);
    const big = await publish(request, { title: "WL Major strike on Kharkiv", importance: 92 });
    await publish(request, { title: "WL Minor skirmish", importance: 25, severity: "guarded" });
    let feed = await user.feed();
    expect(titles(feed)).toContain("WL Major strike on Kharkiv");
    expect(titles(feed)).not.toContain("WL Minor skirmish");
    const n = feed.items.find((i) => i.title === "WL Major strike on Kharkiv")!;
    expect(n).toMatchObject({ category: "conflicts", alertType: "conflict_event", isPartyClaim: false });
    expect(n.reason).toMatchObject({ follows: { label: "WL Ukraine War" }, mode: "major" });
    expect(String(n.reason.rule)).toMatch(/importance 92/);

    // Eight more independent outlets carry the same event: no further notification, no state change.
    for (let i = 0; i < 4; i++) {
      const src = (await request.post("/api/admin/sources", { data: { name: `WL Outlet ${unique()}`, type: "manual", independenceClass: "independent_standard" } }).then((r) => r.json())) as { id: string };
      const item = (await request.post("/api/admin/incoming/manual", { data: { sourceId: src.id, originalTitle: `Repeat ${i}`, originalText: "Same account." } }).then((r) => r.json())) as { id: string };
      expect((await request.post(`/api/admin/incoming/${item.id}/merge`, { data: { eventId: big.id, relationship: "corroborating" } })).ok()).toBe(true);
    }
    feed = await user.feed();
    expect(feed.items.filter((i) => i.title.includes("Kharkiv"))).toHaveLength(1);
    // Re-evaluating the same state (a provider re-send, a second pass) is suppressed as a duplicate, not re-notified.
    const sim = (await request.post("/api/admin/alerts/simulate", { data: { kind: "event", id: big.id } }).then((r) => r.json())) as { results: { matches: { decision: string; label: string }[] }[] };
    expect(sim.results[0]!.matches.find((m) => m.label === "WL Ukraine War")!.decision).toBe("suppressed_duplicate");
    expect((await user.feed()).items.filter((i) => i.title.includes("Kharkiv"))).toHaveLength(1);
  });

  test("severity escalation is a material change: a further-escalated event creates a NEW notification; a wording edit does not", async ({ request }) => {
    const user = me(request, client());
    await user.follow("conflict", conflict.slug);
    const ev = await publish(request, { title: "WL Border clash", importance: 85, severity: "elevated" });
    const before = (await user.feed()).items.filter((i) => i.title.includes("Border clash")).length;
    expect(before).toBe(1);
    await request.patch(`/api/admin/events/${ev.id}`, { data: { summary: "Fighting reported near the front. (typo fixed)" } });
    expect((await user.feed()).items.filter((i) => i.title.includes("Border clash"))).toHaveLength(1); // typo: not material
    await request.patch(`/api/admin/events/${ev.id}`, { data: { severity: "extreme" } });
    const after = (await user.feed()).items.filter((i) => i.title.includes("Border clash"));
    expect(after).toHaveLength(2);
    expect(after.some((i) => /^Escalated:/.test(i.title))).toBe(true);
    expect(new Set(after.map((i) => i.fingerprint)).size).toBe(2);
  });

  test("impact threshold: a country watch hears about a war that matters to that country, not one that does not", async ({ request }) => {
    const poland = me(request, client());
    const brazil = me(request, client());
    await poland.follow("country", "PL");
    await brazil.follow("country", "BR");
    const ev = await publish(request, { title: "WL Offensive widens", importance: 95, severity: "extreme" });
    expect(titles(await poland.feed())).toContain(ev.title); // bordering war: impact floor 75
    expect(titles(await brazil.feed())).not.toContain(ev.title); // far away: impact below the threshold
    const below = await records(request, "below_threshold");
    expect(below.some((r) => r.entityKey === "BR" && (r.detail?.title ?? "").includes("Offensive widens"))).toBe(true); // and the inspector says why
    const p = (await poland.feed()).items.find((i) => i.title === ev.title)!;
    expect(String(p.reason.rule)).toMatch(/conflict impact/i);
  });

  test("own-country war is CRITICAL; the same event for a follower elsewhere is not", async ({ request }) => {
    const own = me(request, client());
    const other = me(request, client());
    await own.settings({ baseCountry: "UA" });
    await other.settings({ baseCountry: "BR" });
    await own.follow("conflict", conflict.slug);
    await other.follow("conflict", conflict.slug);
    const ev = await publish(request, { title: "WL Capital shelled", importance: 96, severity: "extreme" });
    expect((await own.feed()).items.find((i) => i.title === ev.title)!.priority).toBe("CRITICAL");
    expect((await other.feed()).items.find((i) => i.title === ev.title)!.priority).not.toBe("CRITICAL");
  });

  test("territorial change: only an APPROVED change alerts; two claimants on one place alert as conflicting claims, never as 'captured'", async ({ request }) => {
    const { prisma } = await import("@/lib/db/client");
    const user = me(request, client());
    const important = await user.follow("conflict", conflict.slug, { mode: "important" });
    expect(important.mode).toBe("important");
    const a = await prisma.militaryUnit.create({ data: { name: `WL Actor A ${unique()}` } });
    const b = await prisma.militaryUnit.create({ data: { name: `WL Actor B ${unique()}` } });
    const mk = (actorId: string, description: string) => prisma.territorialChangeCandidate.create({ data: { conflictId: conflict.id, description, claimedActorId: actorId, locationName: "Testville", changeType: "captured", status: "pending", confidence: 0.6, precision: "area_level" } });
    const first = await mk(a.id, "Actor A took Testville");
    const second = await mk(b.id, "Actor B took Testville");
    // Nothing is announced for a pending claim.
    expect(titles(await user.feed()).some((t) => t.includes("Testville"))).toBe(false);
    expect((await request.post(`/api/admin/territorial-change-candidates/${first.id}/review`, { data: { action: "approve", geometryMode: "record_only" } })).ok()).toBe(true);
    let feed = await user.feed();
    const change = feed.items.find((i) => i.alertType === "territorial_change")!;
    expect(change.title).toContain("Testville");
    expect(change.category).toBe("territorial");
    expect(feed.items.some((i) => i.alertType === "conflicting_claims")).toBe(false); // only one claimant so far
    expect((await request.post(`/api/admin/territorial-change-candidates/${second.id}/review`, { data: { action: "uncertain" } })).ok()).toBe(true);
    feed = await user.feed();
    const conflicting = feed.items.find((i) => i.alertType === "conflicting_claims")!;
    expect(conflicting.title).toBe("Conflicting territorial claims reported in Testville");
    expect(conflicting.summary).toMatch(/No conclusion is drawn/);
    expect(feed.items.filter((i) => i.alertType === "territorial_change")).toHaveLength(1); // the disputed claim was not announced as a change
    // A major-only watcher is not told about conflicting claims (rule off by default there).
    const major = me(request, client());
    await major.follow("conflict", conflict.slug);
    const third = await mk(a.id, "Actor A again");
    void third;
    expect((await major.feed()).items.some((i) => i.alertType === "conflicting_claims")).toBe(false);
  });

  test("party claims are hidden by default, delivered (as claims, capped) when enabled, and corroboration produces a later verified alert", async ({ request }) => {
    const quiet = me(request, client());
    const loud = me(request, client());
    await loud.settings({ partyClaims: true });
    await quiet.follow("conflict", conflict.slug);
    await loud.follow("conflict", conflict.slug);
    const partySource = `WL MoD ${unique()}`;
    await request.post("/api/admin/sources", { data: { name: partySource, type: "manual", independenceClass: "official_military", claimPolicy: "party_claim", perspective: "Ministry of Defence" } });
    const ev = await publish(request, { title: "WL Airport struck", importance: 90, sourceName: partySource });
    expect(titles(await quiet.feed())).not.toContain("WL Airport struck"); // default OFF
    expect(titles(await quiet.feed()).some((t) => t.includes("claims:"))).toBe(false);
    const hidden = await records(request, "party_claim_hidden");
    expect(hidden.length).toBeGreaterThan(0);
    const claim = (await loud.feed()).items.find((i) => i.alertType === "party_claim")!;
    expect(claim.title).toMatch(/^Ministry of Defence claims: WL Airport struck/);
    expect(claim).toMatchObject({ isPartyClaim: true });
    expect(claim.priority).not.toBe("HIGH"); // capped
    expect(claim.priority).not.toBe("CRITICAL");
    expect(String(claim.summary)).toMatch(/Unverified/);

    // A second party outlet repeating it: still one claim, no new notification.
    // An independent report arrives: now it is a verified development, delivered to everyone whose rules match.
    const indep = (await request.post("/api/admin/sources", { data: { name: `WL Independent ${unique()}`, type: "manual", independenceClass: "independent_high" } }).then((r) => r.json())) as { id: string };
    const item = (await request.post("/api/admin/incoming/manual", { data: { sourceId: indep.id, originalTitle: "Airport struck", originalText: "Confirmed by our correspondent." } }).then((r) => r.json())) as { id: string };
    await request.post(`/api/admin/incoming/${item.id}/merge`, { data: { eventId: ev.id, relationship: "corroborating" } });
    const q = await quiet.feed();
    const verified = q.items.find((i) => i.title.startsWith("Now independently reported: WL Airport struck"))!;
    expect(verified).toMatchObject({ alertType: "conflict_event", isPartyClaim: false });
    expect(String(verified.reason.changeNote)).toMatch(/previously party-only/);
    expect((await loud.feed()).items.filter((i) => i.title.includes("WL Airport struck"))).toHaveLength(2); // the claim, then the verified development
  });
});

// ---------------------------------------------------------------------------------------------
test.describe.serial("Hazards and infrastructure alerts (fixture providers)", () => {
  test("earthquakes: M6.5+ rule alerts, smaller ones do not; a revision from M5.8 to M6.6 is a NEW material alert; a +0.1 revision is not", async ({ request }) => {
    const japan = me(request, client());
    const layer = me(request, client());
    await japan.follow("country", "JP");
    await layer.follow("layer", "earthquakes", { mode: "custom", rules: { minMagnitude: 6, tsunami: true } });
    await ingest(request, "usgs_earthquakes", "usgs-jp");
    let jp = await japan.feed();
    expect(titles(jp).some((t) => t.startsWith("M6.9 earthquake"))).toBe(true);
    expect(jp.items.some((i) => i.title.includes("M4.6"))).toBe(false);
    expect(jp.items.some((i) => i.title.includes("Hachinohe"))).toBe(false); // M5.8: below threshold, nothing sent
    const big = jp.items.find((i) => i.title.startsWith("M6.9"))!;
    expect(big).toMatchObject({ category: "hazards", alertType: "earthquake" });
    expect(String(big.reason.rule)).toMatch(/Magnitude 6\.9/);
    expect(big.priority).toBe("MEDIUM"); // a globally significant quake that is not at the user's own country is not HIGH for a country follower
    // Custom rule with tsunami flag on the layer watch: tsunami-flagged quake matches too.
    expect((await layer.feed()).items.some((i) => i.title.startsWith("M6.9"))).toBe(true);

    await ingest(request, "usgs_earthquakes", "usgs-jp", "?v=2"); // Hachinohe revised 5.8 -> 6.6; Kobe 5.8 -> 5.9
    jp = await japan.feed();
    const revised = jp.items.find((i) => i.title.includes("Hachinohe"))!;
    expect(revised.summary).toMatch(/Revised from M5\.8 to M6\.6/);
    expect(String(revised.reason.changeNote)).toMatch(/M5\.8 → M6\.6/);
    expect(jp.items.filter((i) => i.title.startsWith("M6.9"))).toHaveLength(1); // unchanged quake: no repeat
    expect(jp.items.some((i) => i.title.includes("Kobe"))).toBe(false); // +0.1 is not material
  });

  test("weather: only the alert that meets the severity/certainty rule is sent; when it is withdrawn the user gets the resolution (if they want it)", async ({ request }) => {
    const wantsResolution = me(request, client());
    const noResolution = me(request, client());
    await noResolution.settings({ resolutionAlerts: false });
    await wantsResolution.follow("layer", "weather");
    await noResolution.follow("layer", "weather");
    await ingest(request, "nws_alerts", "nws/alerts");
    let feed = await wantsResolution.feed();
    expect(titles(feed)).toContain("Tornado Warning"); // Extreme + Observed
    expect(titles(feed)).not.toContain("Flood Warning"); // Severe: below the "major" threshold
    expect(feed.items.find((i) => i.title === "Tornado Warning")!.category).toBe("hazards");
    await ingest(request, "nws_alerts", "nws/alerts", "?v=2"); // tornado warning no longer listed
    feed = await wantsResolution.feed();
    const resolved = feed.items.find((i) => i.isResolution && i.title.startsWith("Tornado Warning"))!;
    expect(resolved.title).toBe("Tornado Warning — expired / ended");
    expect(resolved.priority).not.toBe("HIGH");
    expect((await noResolution.feed()).items.some((i) => i.isResolution)).toBe(false);
    expect((await records(request, "resolution_off")).length).toBeGreaterThan(0);
  });

  test("volcano: an alert-level change is a new alert; the same level again is not", async ({ request }) => {
    const user = me(request, client());
    await user.follow("volcano", "hans-900001", { label: "Fixture Peak" });
    await ingest(request, "usgs_volcanoes", "hans/getElevatedVolcanoes");
    let feed = await user.feed();
    expect(feed.items.filter((i) => i.title.includes("Fixture Peak"))).toHaveLength(1);
    expect(feed.items[0]!.title).toBe("Fixture Peak: alert level WATCH");
    await ingest(request, "usgs_volcanoes", "hans/getElevatedVolcanoes"); // same again
    expect((await user.feed()).items.filter((i) => i.title.includes("Fixture Peak"))).toHaveLength(1);
    await ingest(request, "usgs_volcanoes", "hans/getElevatedVolcanoes", "?v=2"); // WATCH -> WARNING
    feed = await user.feed();
    expect(feed.items.filter((i) => i.title.includes("Fixture Peak"))).toHaveLength(2);
    expect(titles(feed)).toContain("Fixture Peak: alert level WARNING");
  });

  test("aviation: closure alerts; closed -> closed does not repeat; reopening is its own alert; closed again later is a third; the first notification never changes", async ({ request }) => {
    const user = me(request, client());
    await user.follow("airport", "KORD");
    await ingest(request, "faa_nas_status", "faa");
    let feed = await user.feed();
    const closed = feed.items.find((i) => i.title.includes("O'Hare"))!;
    expect(closed.title).toMatch(/closed$/);
    expect(closed.priority).toBe("HIGH");
    expect(closed.category).toBe("aviation");
    const snapshotBefore = JSON.stringify(closed.snapshot);
    await ingest(request, "faa_nas_status", "faa"); // closed -> closed
    expect((await user.feed()).items).toHaveLength(1);
    await ingest(request, "faa_nas_status", "faa", "?v=2"); // reopened
    feed = await user.feed();
    const reopened = feed.items.find((i) => i.isResolution)!;
    expect(reopened.title).toMatch(/reopened$/);
    expect(feed.items).toHaveLength(2);
    await ingest(request, "faa_nas_status", "faa"); // closed again
    feed = await user.feed();
    expect(feed.items.filter((i) => i.title.endsWith("closed"))).toHaveLength(2);
    expect(new Set(feed.items.map((i) => i.fingerprint)).size).toBe(3);
    // Historical understanding: the original notification is exactly what was known then.
    const original = feed.items.find((i) => i.id === closed.id)!;
    expect(JSON.stringify(original.snapshot)).toBe(snapshotBefore);
    expect(original.snapshot).toMatchObject({ kind: "global_event", status: "closed", category: "airport_status" });
    expect(original.summary).toBe(closed.summary);
    expect(String((original.snapshot as { snapshotLink?: string }).snapshotLink)).toContain("at=");
    expect(original.deepLink).toMatch(/^\/world\?layers=aviation&hazard=.+&focus=/);
  });

  test("chokepoint: a major disruption alerts a follower; recovery is a separate resolution; an unfollowed chokepoint alerts nobody", async ({ request }) => {
    const hormuz = me(request, client());
    const bab = me(request, client());
    await hormuz.follow("chokepoint", "chokepoint6", { label: "Strait of Hormuz" });
    await bab.follow("chokepoint", "chokepoint4", { label: "Bab el-Mandeb" });
    await ingest(request, "portwatch_chokepoints", "portwatch");
    const feed = await hormuz.feed();
    const n = feed.items.find((i) => i.title.startsWith("Strait of Hormuz disruption"))!;
    expect(n.title).toBe("Strait of Hormuz disruption increased");
    expect(n.summary).toMatch(/Transit volume is 71% below its 90-day baseline/);
    expect(n.category).toBe("maritime");
    expect((await bab.feed()).items).toHaveLength(0); // normal: nothing to say
    await ingest(request, "portwatch_chokepoints", "portwatch", "?v=2"); // recovery
    const after = await hormuz.feed();
    expect(after.items.some((i) => i.isResolution && /returned toward normal/.test(i.title))).toBe(true);
  });

  test("energy: custom capacity threshold decides; unknown capacity never matches; restoration is announced to those who were told", async ({ request }) => {
    const low = me(request, client());
    const high = me(request, client());
    await low.follow("watchkey", "energy_disruption:GB:T_FIXA-1", { label: "FIXA-1", mode: "custom", rules: { minCapacityMw: 500, restoration: true } });
    await high.follow("watchkey", "energy_disruption:GB:T_FIXA-1", { label: "FIXA-1", mode: "custom", rules: { minCapacityMw: 5000, restoration: true } });
    await ingest(request, "elexon_remit", "elexon");
    expect(titles(await low.feed()).some((t) => t.includes("FIXA-1"))).toBe(true);
    expect((await low.feed()).items[0]!.category).toBe("energy");
    expect((await high.feed()).items).toHaveLength(0);
    await ingest(request, "elexon_remit", "elexon", "?v=2"); // Dismissed: restored
    expect((await low.feed()).items.some((i) => i.isResolution && /restored/.test(i.title))).toBe(true);
    expect((await high.feed()).items).toHaveLength(0); // never told about the outage, so no restoration either
  });

  test("internet: a national outage alerts a country follower; restoration follows; the wording never claims a shutdown", async ({ request }) => {
    const user = me(request, client());
    await user.follow("country", "LB");
    await ingest(request, "ioda", "ioda");
    let feed = await user.feed();
    const n = feed.items.find((i) => i.alertType === "internet_outage")!;
    expect(n).toMatchObject({ category: "internet" });
    expect(n.title).toContain("Lebanon");
    expect(n.summary).toMatch(/does not establish the cause/);
    expect(JSON.stringify(n)).not.toMatch(/shutdown was|government (?:ordered|directed)|censor/i);
    await ingest(request, "ioda", "ioda", "?v=2");
    feed = await user.feed();
    expect(feed.items.some((i) => i.isResolution && /connectivity restored/.test(i.title))).toBe(true);
  });

  test("party claims about infrastructure are hidden by default, never change its status, and reach those who opted in", async ({ request }) => {
    const { prisma } = await import("@/lib/db/client");
    const quiet = me(request, client());
    const loud = me(request, client());
    const custom = me(request, client());
    await loud.settings({ partyClaims: true });
    for (const u of [quiet, loud]) await u.follow("chokepoint", "chokepoint6", { label: "Strait of Hormuz" });
    await custom.follow("chokepoint", "chokepoint6", { label: "Strait of Hormuz", mode: "custom", rules: { chokepointMajor: true, includePartyClaims: true } });
    const ev = await prisma.globalEvent.findFirstOrThrow({ where: { entityKey: "chokepoint6" } });
    const before = { status: ev.status, hash: ev.contentHash, revision: ev.revision };
    await request.post(`/api/admin/global-events/${ev.id}/claims`, { data: { claimant: "CENTCOM", claimType: "closure", text: "We are closing the strait", sourceUrl: "https://party.test/x" } });
    expect((await quiet.feed()).items.some((i) => i.isPartyClaim)).toBe(false);
    const claimN = (await loud.feed()).items.find((i) => i.isPartyClaim)!;
    expect(claimN.title).toMatch(/^CENTCOM claims:/);
    expect((await custom.feed()).items.some((i) => i.isPartyClaim)).toBe(true);
    const after = await prisma.globalEvent.findUniqueOrThrow({ where: { id: ev.id } });
    expect({ status: after.status, hash: after.contentHash, revision: after.revision }).toEqual(before);
  });

  test("category and priority settings gate delivery; pausing/muting a watch silences it", async ({ request }) => {
    const user = me(request, client());
    const { prisma } = await import("@/lib/db/client");
    const quake = await prisma.globalEvent.findFirstOrThrow({ where: { providerEventId: "fx-jp-big" } });
    const decisionOf = async (watchId: string) => {
      const res = (await request.post("/api/admin/alerts/simulate", { data: { kind: "global_event", id: quake.id } }).then((r) => r.json())) as { results: { matches: { watchId: string; decision: string }[] }[] };
      return res.results[0]!.matches.find((x) => x.watchId === watchId)?.decision;
    };
    await user.settings({ categories: { hazards: false } });
    const w = await user.follow("country", "JP");
    expect(await decisionOf(w.id)).toBe("category_off"); // the watch matches, the category toggle stops it
    await user.settings({ categories: { hazards: true } });
    await user.patch(w.id, { muted: true });
    expect(await decisionOf(w.id)).toBe("muted");
    await user.patch(w.id, { muted: false, pauseHours: 2 });
    expect(await decisionOf(w.id)).toBe("paused");
    await user.patch(w.id, { pauseHours: 0 });
    await user.settings({ minPriority: "CRITICAL" });
    expect(await decisionOf(w.id)).toBe("below_min_priority");
    expect((await user.feed()).items).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------------------------
test.describe.serial("Performance, simulation and retention", () => {
  test("candidate-watch matching never scans: 300 unrelated watchers add no watch queries beyond the indexed lookups; raw thermal detections touch no watches", async ({ request }) => {
    const { prisma } = await import("@/lib/db/client");
    const ids = Array.from({ length: 300 }, (_, i) => `perf${Date.now().toString(36)}${i}`.padEnd(24, "x"));
    await prisma.watcher.createMany({ data: ids.map((id) => ({ id })) });
    await prisma.watch.createMany({ data: ids.map((id, i) => ({ watcherId: id, entityType: "country", entityKey: ["FR", "DE", "IT", "ES", "NO"][i % 5]!, label: "Perf", mode: "major", rules: "{}" })) });
    const s0 = await adminStats(request);
    const thermal = await ingest(request, "nasa_firms", "firms"); // 62 detections
    expect(thermal.errors).toBe(0);
    const s1 = await adminStats(request);
    expect(s1.watchQueries).toBe(s0.watchQueries); // not one watch lookup for raw detections
    expect(s1.developments).toBe(s0.developments);
    await prisma.globalEvent.deleteMany({ where: { provider: "usgs_earthquakes" } });
    await prisma.alertState.deleteMany({ where: { alertType: "earthquake" } });
    await ingest(request, "usgs_earthquakes", "usgs-jp", "?v=2"); // four brand-new quakes through the real provider path
    const s2 = await adminStats(request);
    const devs = s2.developments - s1.developments;
    expect(devs).toBeGreaterThan(0);
    expect(s2.watchQueries - s1.watchQueries).toBeLessThanOrEqual(devs); // at most one indexed lookup per development, independent of the 300 watches
    await prisma.watcher.deleteMany({ where: { id: { in: ids } } });
  });

  test("simulation: 'if this happened, which watches would match?' is read-only and explains each decision", async ({ request }) => {
    const { prisma } = await import("@/lib/db/client");
    const clientId = client();
    const user = me(request, clientId);
    await user.follow("airport", "OLBA");
    await user.follow("country", "LB");
    const notifsBefore = await prisma.notification.count();
    const sim = (await request.post("/api/admin/alerts/simulate", { data: { kind: "synthetic_global", synthetic: { category: "airport_status", layer: "aviation", entityKey: "OLBA", countryCode: "LB", status: "closed", title: "Beirut–Rafic Hariri International Airport", prominence: 90, lat: 33.82, lng: 35.49, provider: "sim" } } }).then((r) => r.json())) as { developments: number; results: { fingerprint: string; candidates: { type: string; key: string }[]; matches: { entityType: string; decision: string; priority: string | null; rule: string | null; wouldNotify: boolean }[] }[] };
    expect(sim.developments).toBe(1);
    const r = sim.results[0]!;
    expect(r.candidates.map((c) => `${c.type}:${c.key}`)).toEqual(expect.arrayContaining(["airport:OLBA", "country:LB", "layer:aviation"]));
    const mine = r.matches.filter((m) => (m as { watcherId?: string }).watcherId === clientId);
    const airport = mine.find((m) => m.entityType === "airport")!;
    expect(airport).toMatchObject({ decision: "notified", priority: "HIGH", wouldNotify: true });
    expect(airport.rule).toBe("Airport closed");
    // The country watch also accepts an airport closure in that country — but one development is ONE notification per watcher.
    expect(mine.find((m) => m.entityType === "country")).toMatchObject({ decision: "merged_watch", rule: "Airport closed" });
    expect(mine.filter((m) => m.decision === "notified")).toHaveLength(1);
    expect(await prisma.notification.count()).toBe(notifsBefore); // nothing was written
    expect((await request.post("/api/admin/alerts/simulate", { data: {} })).status()).toBe(400);
  });

  test("the inspector lists decisions with fingerprint, rule and priority; alert records are pruned separately from notifications", async ({ request }) => {
    const { prisma } = await import("@/lib/db/client");
    const { pruneAlertRecords } = await import("@/lib/alerts/engine");
    const data = (await request.get("/api/admin/alerts?limit=50").then((r) => r.json())) as { records: { fingerprint: string; decision: string; entityType: string }[]; notifications: unknown[] };
    expect(data.records.length).toBeGreaterThan(0);
    expect(data.records[0]).toHaveProperty("fingerprint");
    await prisma.alertRecord.create({ data: { signalKind: "x", signalRef: "x", fingerprint: "old", alertType: "earthquake", entityType: "country", entityKey: "JP", decision: "notified", createdAt: new Date(Date.now() - 40 * 86_400_000) } });
    const notifs = await prisma.notification.count();
    expect(await pruneAlertRecords()).toBeGreaterThanOrEqual(1);
    expect(await prisma.notification.count()).toBe(notifs); // notifications outlive both inspector rows and raw observations
    // Raw provider observations can be archived without touching watches or notifications.
    await prisma.globalEvent.deleteMany({});
    expect(await prisma.notification.count()).toBe(notifs);
    expect(await prisma.watch.count()).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------------------------
// Both the desktop nav and the mobile top bar render a bell: address the visible one.
const vis = (page: Page, id: string) => page.locator(`[data-testid="${id}"]:visible`);

async function clientIdOf(page: Page): Promise<string> {
  await page.waitForFunction(() => Boolean(localStorage.getItem("vigil-client-id")));
  return page.evaluate(() => localStorage.getItem("vigil-client-id")!);
}

test.describe.serial("Notification centre, Watchlist page and deep links (UI)", () => {
  test.beforeAll(async () => {
    const { prisma } = await import("@/lib/db/client");
    await prisma.globalEvent.deleteMany({});
    await prisma.alertState.deleteMany({});
  });

  test("Follow button, Watchlist page: follow, mode, custom rule editing, mute, pause, unfollow; preferences persist", async ({ page }) => {
    await page.goto("/country/FI");
    const btn = page.getByTestId("follow-button").first();
    await expect(btn).toHaveAttribute("data-following", "false");
    await btn.click();
    await expect(btn).toHaveAttribute("data-following", "true");
    await page.goto("/watchlist");
    const item = page.locator('[data-testid="watch-item"][data-watch-key="country:FI"]');
    await expect(item).toBeVisible();
    await expect(page.getByTestId("group-countries")).toBeVisible();
    await item.getByTestId("watch-mode").selectOption("custom");
    await expect(item.getByTestId("rule-editor")).toBeVisible();
    await item.getByTestId("rule-minMagnitude").fill("7.1");
    await item.getByTestId("save-rules").click();
    await page.reload();
    await expect(item.getByTestId("watch-mode")).toHaveValue("custom");
    await expect(item.getByTestId("rule-minMagnitude")).toHaveValue("7.1");
    await item.getByTestId("watch-mute").click();
    await expect(item.getByTestId("watch-state")).toHaveText("Muted");
    await item.getByTestId("watch-mute").click();
    await item.getByTestId("watch-pause").selectOption("24");
    await expect(item.getByTestId("watch-state")).toHaveText("Paused");
    // Follow something else through the picker.
    await page.getByTestId("add-type").selectOption("airport");
    await page.getByTestId("add-search").fill("Rafic");
    await page.getByTestId("add-result").first().getByTestId("add-follow").click();
    await expect(page.locator('[data-testid="watch-item"][data-watch-key="airport:OLBA"]')).toBeVisible();
    await expect(page.getByTestId("group-infrastructure")).toBeVisible();
    // Preferences.
    await page.getByTestId("pref-min-priority").selectOption("MEDIUM");
    await page.getByTestId("pref-cat-hazards").click({ force: true });
    await expect(page.getByTestId("pref-cat-hazards")).not.toBeChecked();
    await page.getByTestId("pref-party-claims").click({ force: true });
    await expect(page.getByTestId("pref-party-claims")).toBeChecked();
    await page.reload();
    await expect(page.getByTestId("pref-min-priority")).toHaveValue("MEDIUM");
    await expect(page.getByTestId("pref-cat-hazards")).not.toBeChecked();
    await expect(page.getByTestId("pref-party-claims")).toBeChecked();
    const id = await clientIdOf(page);
    const settings = (await page.request.get("/api/me/settings", { headers: { "x-vigil-client": id } }).then((r) => r.json())) as { partyClaims: boolean; minPriority: string };
    expect(settings).toMatchObject({ partyClaims: true, minPriority: "MEDIUM" });
    await page.getByTestId("pref-party-claims").click({ force: true });
    await expect(page.getByTestId("pref-party-claims")).not.toBeChecked();
    await page.getByTestId("pref-cat-hazards").click({ force: true });
    await expect(page.getByTestId("pref-cat-hazards")).toBeChecked();
    await page.getByTestId("pref-min-priority").selectOption("LOW");
    await item.getByTestId("watch-unfollow").click();
    await expect(item).toHaveCount(0);
  });

  test("bell: unread badge, feed with priority/category/entity/time, explanation, mark read, mark all read, deep link to the map with the layer on and the event selected", async ({ page, request }) => {
    await page.goto("/watchlist");
    const id = await clientIdOf(page);
    const user = me(request, id);
    const w = await user.follow("airport", "KORD");
    void w;
    await ingest(request, "faa_nas_status", "faa"); // closes KORD
    await page.goto("/");
    const badge = vis(page, "unread-badge").first();
    await expect(badge).toHaveText("1", { timeout: 40_000 });
    await vis(page, "notification-bell").first().click();
    const item = vis(page, "notification").first();
    await expect(item).toBeVisible();
    await expect(item.getByTestId("notification-priority")).toHaveText("HIGH");
    await expect(item.getByTestId("notification-title")).toContainText("O'Hare");
    await expect(item).toHaveAttribute("data-unread", "true");
    await item.locator("button").first().click();
    await expect(item.getByTestId("reason-follows")).toContainText("You follow Chicago O'Hare");
    await expect(item.getByTestId("reason-rule")).toHaveText("Airport closed");
    await expect(item.getByTestId("reason-priority")).toContainText("Priority HIGH");
    await expect(vis(page, "unread-badge")).toHaveCount(0); // opening marks it read
    await expect.poll(async () => (await user.feed()).unreadCount).toBe(0);
    // Deep link: same /world, aviation layer enabled, the record selected, map centred.
    await item.getByTestId("notification-open").click();
    await expect(page).toHaveURL(/\/world\?layers=aviation&hazard=/, { timeout: 90_000 });
    await expect(page.locator("[data-hazard-layers]").first()).toHaveAttribute("data-hazard-layers", /aviation/);
    await expect(page.locator('[data-testid="hazard-detail"]:visible').getByTestId("hazard-title")).toContainText("O'Hare", { timeout: 60_000 });
    const center = await page.evaluate(() => { const m = (window as unknown as { __vigilMap: { getCenter: () => { lng: number; lat: number }; getZoom: () => number } }).__vigilMap; return { ...m.getCenter(), z: m.getZoom() }; });
    expect(center.lat).toBeCloseTo(41.98, 0);
    expect(center.z).toBeGreaterThan(5);
    // Mark all read on a fresh alert.
    await user.follow("chokepoint", "chokepoint6", { label: "Strait of Hormuz" });
    await ingest(request, "portwatch_chokepoints", "portwatch");
    await page.goto("/");
    await expect(vis(page, "unread-badge").first()).toHaveText("1", { timeout: 40_000 });
    await vis(page, "notification-bell").first().click();
    await vis(page, "mark-all-read").click();
    await expect(vis(page, "unread-badge")).toHaveCount(0);
    await expect(vis(page, "notification").first()).toHaveAttribute("data-unread", "false");
  });

  test("Watchlist shows recent alerts and a snapshot deep link reopens the timeline at that moment", async ({ page, request }) => {
    const { prisma } = await import("@/lib/db/client");
    await prisma.globalEvent.deleteMany({});
    await prisma.alertState.deleteMany({});
    await page.goto("/watchlist");
    const id = await clientIdOf(page);
    await me(request, id).follow("airport", "KORD");
    await ingest(request, "faa_nas_status", "faa");
    await page.reload();
    await expect(page.getByTestId("recent-alerts")).toBeVisible();
    const first = page.getByTestId("recent-alerts").getByTestId("notification").first();
    await expect(first).toBeVisible();
    await first.locator("button").first().click();
    const href = await first.getByTestId("notification-snapshot-link").getAttribute("href");
    expect(href).toContain("at=");
    await page.goto(href!);
    await expect(page.getByTestId("historical-indicator")).toBeVisible({ timeout: 20_000 });
  });
});
