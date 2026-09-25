import type { GlobalEvent } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { sourceTrust, summarizeEvidence, type EvidenceSummary } from "@/lib/sources/trust";
import { isNonIndependentRole } from "@/lib/registry/source-tiers";
import { parseCorroboration } from "@/lib/db/repositories/myanmar";
import { conflictGeographyOf } from "@/lib/registry/geography";
import { listConflictingClaims } from "@/lib/public/claims";
import { globalCandidates } from "@/lib/alerts/developments";
import { assessEscalation, assessHotspot, BASELINE_MS, HOUR, sevScore, sevRank, type ActivityEvent, type ConflictTransition } from "./activity";
import { briefSignificance, confidenceLabel, deriveConfidence } from "./scoring";
import { DOMAIN_OF, MIN_SIGNIFICANCE, type BriefDevelopment, type BriefExclusion, type BriefMapTarget, type BriefRange, type BriefSection, type BriefSourceRef, type DevelopmentType, type EscalationAssessment, type HotspotAssessment } from "./types";

// Collects DEVELOPMENTS for a time range from the existing canonical state. Nothing here ingests or
// creates data. Each source of developments is read once for the whole world; scoping (country,
// conflict, watchlist) happens afterwards on the resulting set, so one computation serves every view.

export interface ConflictMeta {
  id: string;
  slug: string;
  name: string;
  fighting: string[];
  status: string;
  lat: number | null;
  lng: number | null;
}

export interface Universe {
  range: { from: string; to: string; window: string; live: boolean };
  developments: BriefDevelopment[];
  excluded: BriefExclusion[];
  escalation: EscalationAssessment[];
  hotspots: HotspotAssessment[];
  conflicts: ConflictMeta[];
  hiddenPartyClaims: number;
}

const iso = (d: Date) => d.toISOString();
const norm = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));
const json = <T,>(s: string | null | undefined, fb: T): T => {
  try {
    return s ? (JSON.parse(s) as T) : fb;
  } catch {
    return fb;
  }
};
const hhmm = (d: Date) => `${d.toISOString().slice(11, 16)} UTC`;
const trunc = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const HISTORY_FIELDS = ["severity", "casualtiesKilled", "casualtiesInjured", "infrastructureDamage"];
const zoomFor: Record<string, number> = { earthquakes: 6, fires: 7, weather: 5, volcanoes: 8, aviation: 7, maritime: 6, energy: 5, internet: 4 };

type Draft = Omit<BriefDevelopment, "significance" | "significanceReasons" | "domain" | "section" | "confidenceLabel" | "impact" | "reasons"> & { reasons?: string[]; sig: { magnitude: number; stateChange: number; scope: number; kindWeight: number; novel: boolean } };

function finish(d: Draft, range: BriefRange): BriefDevelopment {
  const at = new Date(d.occurredAt).getTime();
  const sig = briefSignificance({ ...d.sig, confidence: d.confidence, ageHours: Math.max(0, (range.to.getTime() - at) / HOUR), windowHours: (range.to.getTime() - range.from.getTime()) / HOUR });
  const domain = DOMAIN_OF[d.developmentType];
  const { sig: _omit, ...rest } = d;
  void _omit;
  return { ...rest, domain, section: sectionOf(d.developmentType, d.isResolution, d.currentState), significance: sig.score, significanceReasons: sig.reasons, confidenceLabel: confidenceLabel(d.confidence), impact: null, reasons: d.reasons ?? [] };
}

function sectionOf(t: DevelopmentType, resolution: boolean, current: string | null): BriefSection {
  if (t === "party_claim") return "claims";
  if (t === "escalation") return "escalation";
  if (t === "de_escalation") return "resolution";
  if (t === "conflict_status") return ["reduced", "dormant", "ended", "resolved", "archived"].includes(current ?? "") ? "resolution" : "escalation";
  if (resolution) return "resolution";
  if (DOMAIN_OF[t] === "territory") return "territory";
  if (DOMAIN_OF[t] === "infrastructure") return "infrastructure";
  if (DOMAIN_OF[t] === "hazard") return "hazards";
  return "conflict";
}

const evidenceText = (e: EvidenceSummary) => `${e.independentSources} independent source${e.independentSources === 1 ? "" : "s"}${e.partyClaims > 0 ? ` · ${e.partyClaims} party claim${e.partyClaims === 1 ? "" : "s"}` : ""}`;

// ---------------------------------------------------------------------------------------------
// Conflict events and their material updates
// ---------------------------------------------------------------------------------------------
type EventRow = Awaited<ReturnType<typeof loadChunk>>[number];
// The include tree (sources -> reports -> source, history) makes the database look up related rows with one `IN (...)` per
// level; with a few thousand events that exceeds SQLite's bound-parameter limit ("query parameter limit exceeded"),
// which broke every brief once thousands of reports had been published. Select the ids first, then load them in chunks.
const EVENT_CHUNK = 300;
const eventInclude = { conflict: { select: { id: true, slug: true, name: true, shortName: true, fightingCountries: true, participantCountries: true, supporterCountries: true, geographyBasis: true } }, sources: { include: { rawIngestionItem: { include: { source: true } } } }, militaryUnitLinks: { select: { unitId: true } }, history: { where: { field: { in: HISTORY_FIELDS } }, orderBy: { createdAt: "asc" as const } } };
async function loadEvents(where: object, take: number) {
  const ids = (await prisma.event.findMany({ where: { published: true, origin: "conflict_news", ...where }, select: { id: true }, orderBy: { occurredAt: "desc" }, take })).map((e) => e.id);
  const byId = new Map<string, Awaited<ReturnType<typeof loadChunk>>[number]>();
  for (let i = 0; i < ids.length; i += EVENT_CHUNK) for (const e of await loadChunk(ids.slice(i, i + EVENT_CHUNK))) byId.set(e.id, e);
  return ids.map((id) => byId.get(id)).filter((e): e is NonNullable<typeof e> => !!e);
}
const loadChunk = (ids: string[]) => prisma.event.findMany({ where: { id: { in: ids } }, include: eventInclude });

function reportsFor(e: EventRow, to: Date) {
  const links = e.sources.filter((s) => s.createdAt <= to);
  const reports = links.map((s) => ({ sourceId: s.rawIngestionItem.source.id, url: s.rawIngestionItem.originalUrl, trust: sourceTrust(s.rawIngestionItem.source), relay: s.relationship === "relay" }));
  const summary = summarizeEvidence(reports);
  const refs: BriefSourceRef[] = links.map((s, i) => ({ name: s.rawIngestionItem.source.name, url: s.rawIngestionItem.originalUrl?.trim() ? s.rawIngestionItem.originalUrl : null, role: reports[i]!.relay ? "repeat" : reports[i]!.trust.category === "party_claim" ? "party_claim" : reports[i]!.trust.category === "discovery" ? "discovery" : "independent", trustLabel: reports[i]!.trust.label }));
  // One outlet counts once: later reports from an outlet already listed are labelled repeats, not new evidence.
  const seen = new Set<string>();
  const out = refs.map((r, i) => {
    if (r.role !== "independent") return r;
    const k = reports[i]!.sourceId;
    if (seen.has(k)) return { ...r, role: "repeat" as const };
    seen.add(k);
    return r;
  });
  return { summary, refs: out, latest: links.length ? Math.max(...links.map((s) => (s.rawIngestionItem.publishedAt ?? s.rawIngestionItem.receivedAt).getTime())) : null };
}

/** A field's value as it stood at `to`: accepted history recorded after `to` is undone (oldValue). */
function valueAsOf(e: EventRow, field: string, current: string | null, to: Date): string | null {
  const after = e.history.find((h) => h.field === field && h.createdAt > to);
  return after ? after.oldValue : current;
}

const evEvidence = (summary: EvidenceSummary, official = false) => ({ independentSources: summary.independentSources, partyClaims: summary.partyClaims, discoveryLeads: summary.discoveryLeads, dependentRepeats: summary.dependentRepeats, official, text: evidenceText(summary) });

function eventWatchKeys(e: EventRow): { type: string; key: string }[] {
  const geo = e.conflict ? conflictGeographyOf(e.conflict).fighting : [];
  return [...(e.conflict ? [{ type: "conflict", key: e.conflict.slug }] : []), ...(e.countryCode ? [{ type: "country", key: e.countryCode }] : []), ...geo.map((c) => ({ type: "country", key: c })), ...e.militaryUnitLinks.flatMap((l) => [{ type: "actor", key: l.unitId }, { type: "unit", key: l.unitId }])];
}

function eventDevelopments(rows: EventRow[], range: BriefRange, excluded: BriefExclusion[]): { devs: BriefDevelopment[]; partyHidden: number } {
  const out: BriefDevelopment[] = [];
  let partyHidden = 0;
  for (const e of rows) {
    const to = range.to;
    const { summary, refs, latest } = reportsFor(e, to);
    const severity = valueAsOf(e, "severity", e.severity, to) ?? e.severity;
    const killedRaw = valueAsOf(e, "casualtiesKilled", e.casualtiesKilled == null ? null : String(e.casualtiesKilled), to);
    const killed = killedRaw == null || Number.isNaN(Number(killedRaw)) ? null : Number(killedRaw);
    const partyOnly = summary.independentSources === 0 && summary.partyClaims + summary.discoveryLeads > 0;
    const conf = deriveConfidence({ evidence: summary, verificationStatus: e.verificationStatus, freshnessHours: latest == null ? null : (to.getTime() - latest) / HOUR });
    const known = e.publishedAt ?? e.createdAt;
    const histIn = e.history.filter((h) => h.createdAt >= range.from && h.createdAt <= to);
    const occurredIn = e.occurredAt >= range.from && e.occurredAt <= to;
    const geoKeys = eventWatchKeys(e);
    const base = { firstKnownAt: iso(known), lastUpdatedAt: iso(e.history.at(-1)?.createdAt ?? e.updatedAt), conflictSlug: e.conflict?.slug ?? null, conflictName: e.conflict ? (e.conflict.shortName ?? e.conflict.name) : null, countryCode: e.countryCode, geography: { lat: e.latitude, lng: e.longitude, place: e.locationName, countryCode: e.countryCode }, actors: [] as string[], independentSourceCount: summary.independentSources, partyClaimCount: summary.partyClaims, conflictingClaims: null, sources: refs, evidence: evEvidence(summary), watchKeys: geoKeys, confidence: conf.score, confidenceReasons: conf.reasons, locationScope: e.locationScope ?? (e.latitude != null ? "point" : e.countryCode ? "country" : "unknown"), reportCount: new Set(e.sources.filter((s) => s.createdAt <= to).map((s) => s.rawIngestionItemId)).size };
    const mapTarget: BriefMapTarget = { layers: [], eventId: e.id, eventSlug: e.slug, lat: e.latitude ?? undefined, lng: e.longitude ?? undefined, zoom: e.latitude == null ? undefined : 6, at: iso(e.occurredAt) };
    const deep = `/event/${e.slug}`;
    const facts = `Severity ${severity}${killed ? ` · ${killed} reported dead` : ""}.`;

    if (partyOnly) {
      // Only a party / aligned source says so: a labelled claim, never a fact.
      if (!occurredIn && histIn.length === 0) continue;
      const claimant = refs.find((r) => r.role === "party_claim" || r.role === "discovery");
      const who = e.sources.map((s) => sourceTrust(s.rawIngestionItem.source)).find((t) => t.category === "party_claim")?.perspective || claimant?.name || "A party";
      out.push(finish({ ...base, id: `party:${e.id}`, developmentType: "party_claim", occurredAt: iso(e.occurredAt), title: `${who} claims: ${e.title}`, summary: `${trunc(e.summary, 200)} Unverified: reported only by party / aligned or discovery sources.`, previousState: null, currentState: null, isResolution: false, isPartyClaim: true, confidence: Math.min(conf.score, 0.25), deepLink: deep, mapTarget, sig: { magnitude: 0.6 * sevScore(severity) + 0.4 * e.importance, stateChange: 60, scope: 30, kindWeight: 55, novel: true }, reasons: ["reported only by a party / aligned source; shown as a claim"] }, range));
      partyHidden++;
      continue;
    }

    const magnitude = 0.6 * sevScore(severity) + 0.4 * e.importance;
    const infra = e.eventType === "infrastructure";
    const kindWeight = killed != null && killed >= 10 ? 75 : infra ? 65 : 55;
    const scope = killed != null && killed >= 50 ? 60 : 30;
    if (occurredIn || (e.publishedAt && e.publishedAt >= range.from && e.publishedAt <= to && e.occurredAt < range.from && e.occurredAt >= new Date(range.from.getTime() - 24 * HOUR))) {
      const sevChange = histIn.find((h) => h.field === "severity");
      const killedChange = histIn.find((h) => h.field === "casualtiesKilled");
      out.push(finish({ ...base, id: `event:${e.id}`, developmentType: "conflict_event", occurredAt: iso(e.occurredAt), title: e.title, summary: `${trunc(e.summary, 220)} ${facts} ${evidenceText(summary)}.`, previousState: sevChange?.oldValue ?? null, currentState: severity, isResolution: false, isPartyClaim: false, deepLink: deep, mapTarget, sig: { magnitude, stateChange: sevChange || killedChange ? 90 : 60, scope, kindWeight, novel: true }, reasons: [occurredIn ? "new incident in this period" : "published in this period", ...(sevChange ? [`severity later revised ${sevChange.oldValue ?? "?"} → ${sevChange.newValue}`] : [])] }, range));
    } else if (histIn.length > 0) {
      const sevH = histIn.find((h) => h.field === "severity");
      const killH = histIn.filter((h) => h.field === "casualtiesKilled").at(-1);
      const parts = [sevH ? `severity ${sevH.oldValue ?? "?"} → ${sevH.newValue}` : null, killH ? `reported deaths ${killH.oldValue ?? "?"} → ${killH.newValue}` : null].filter(Boolean) as string[];
      if (parts.length === 0) {
        excluded.push({ id: `evupd:${e.id}`, developmentType: "event_update", title: e.title, reason: "Accepted update changed only descriptive fields (no severity or casualty change)", significance: null });
        continue;
      }
      // A rise only counts as material when it is severity or is backed by two independent groups.
      const material = !!sevH || summary.independentSources >= 2;
      if (!material) {
        excluded.push({ id: `evupd:${e.id}`, developmentType: "event_update", title: e.title, reason: "Casualty revision without two independent source groups", significance: null });
        continue;
      }
      out.push(finish({ ...base, id: `evupd:${histIn.at(-1)!.id}`, developmentType: "event_update", occurredAt: iso(histIn.at(-1)!.createdAt), title: `Update: ${e.title}`, summary: `Recorded change: ${parts.join("; ")}. ${evidenceText(summary)}.`, previousState: sevH?.oldValue ?? killH?.oldValue ?? null, currentState: sevH?.newValue ?? killH?.newValue ?? null, isResolution: false, isPartyClaim: false, deepLink: deep, mapTarget, sig: { magnitude, stateChange: 90, scope, kindWeight, novel: false }, reasons: ["accepted material update to an existing incident"] }, range));
    }
  }
  return { devs: out, partyHidden };
}

// ---------------------------------------------------------------------------------------------
// Territorial change intelligence (approved / under review / conflicting)
// ---------------------------------------------------------------------------------------------
async function territoryDevelopments(range: BriefRange, excluded: BriefExclusion[]): Promise<BriefDevelopment[]> {
  const inWin = { gte: range.from, lte: range.to };
  const rows = await prisma.territorialChangeCandidate.findMany({
    where: { OR: [{ reviewedAt: inWin }, { reviewedAt: null, createdAt: inWin }] },
    include: { conflict: { select: { id: true, slug: true, name: true, shortName: true, fightingCountries: true, participantCountries: true, supporterCountries: true, geographyBasis: true } }, claimedActor: { select: { name: true } }, previousActor: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
    take: 300,
  });
  const out: BriefDevelopment[] = [];
  for (const c of rows) {
    if (c.status === "pending") {
      excluded.push({ id: `territory:${c.id}`, developmentType: "unreviewed_territorial_lead", title: c.description.slice(0, 100), reason: "Unreviewed territorial lead: not public until an admin reviews it", significance: null });
      continue;
    }
    if (c.status !== "approved" && c.status !== "uncertain") continue;
    const at = c.reviewedAt ?? c.createdAt;
    const geo = conflictGeographyOf(c.conflict).fighting;
    const roles = [c.sourceRole, ...parseCorroboration(c.corroboration).map((x) => x.sourceRole ?? null)];
    const independent = roles.filter((r) => r !== null && !isNonIndependentRole(r)).length;
    const where = c.locationName ?? "the area";
    const name = c.conflict.shortName ?? c.conflict.name;
    const sourceRefs: BriefSourceRef[] = [{ name: c.sourceName ?? "Reviewed report", url: c.sourceUrl?.trim() ? c.sourceUrl : null, role: "independent", trustLabel: null }, ...parseCorroboration(c.corroboration).map((x) => ({ name: x.sourceName ?? "Corroborating report", url: x.sourceUrl?.trim() ? x.sourceUrl : null, role: (isNonIndependentRole(x.sourceRole ?? null) ? "repeat" : "independent") as BriefSourceRef["role"], trustLabel: null }))];
    const a = c.claimedActor?.name ?? null;
    const b = c.previousActor?.name ?? null;
    const approved = c.status === "approved";
    let type: DevelopmentType = approved ? "territory_changed" : "territory_under_review";
    let title: string;
    let summary: string;
    if (approved) {
      switch (c.changeType) {
        case "withdrawn":
          title = `${a ?? "A party"} withdrew from ${where}`;
          summary = `${a ?? "A party"} withdrew from ${where}, per admin-reviewed territorial evidence.`;
          break;
        case "contested":
          type = "territory_conflicting";
          title = `Control of ${where} is contested`;
          summary = `Control of ${where} is recorded as contested after admin review; no change of control is asserted.`;
          break;
        case "control_uncertain":
          type = "territory_under_review";
          title = `Control of ${where} is uncertain`;
          summary = `Control of ${where} is recorded as uncertain after admin review; no change of control is asserted.`;
          break;
        default:
          title = `Control of ${where} changed${b ? ` from ${b}` : ""}${a ? ` to ${a}` : ""}`;
          summary = `Control of ${where} changed${b ? ` from ${b}` : ""}${a ? ` to ${a}` : ""} after admin-reviewed territorial evidence.`;
      }
    } else {
      title = `Possible territorial change under review: ${where}`;
      summary = `A reported change of control at ${where}${a ? ` in favour of ${a}` : ""} is under review and is not confirmed.`;
    }
    const conf = approved ? Math.min(0.95, 0.7 + 0.1 * Math.min(2, independent)) : Math.min(0.55, 0.3 + 0.1 * independent);
    const magnitude = approved ? ({ captured: 85, transferred: 85, withdrawn: 75, contested: 55, control_uncertain: 45 }[c.changeType] ?? 70) : 55;
    const mapTarget: BriefMapTarget = { layers: [], territory: true, ...(c.lat != null && c.lng != null ? { lat: c.lat, lng: c.lng, zoom: 8 } : {}), at: iso(at) };
    out.push(
      finish(
        {
          id: `territory:${c.id}${approved ? "" : ":review"}`,
          developmentType: type,
          occurredAt: iso(c.observedAt ?? at),
          firstKnownAt: iso(c.createdAt),
          lastUpdatedAt: iso(at),
          title,
          summary: `${summary} ${approved ? `${independent > 0 ? `${independent} independent source${independent === 1 ? "" : "s"}` : "Reviewed evidence"}.` : "Independent confirmation is not yet established."}`,
          previousState: approved ? b : null,
          currentState: approved ? a : null,
          isResolution: false,
          isPartyClaim: false,
          confidence: conf,
          confidenceReasons: approved ? ["approved after admin review", `${independent} independent source${independent === 1 ? "" : "s"}`] : ["under review; not confirmed"],
          countryCode: geo[0] ?? null,
          geography: { lat: c.lat, lng: c.lng, place: c.locationName, countryCode: geo[0] ?? null },
          conflictSlug: c.conflict.slug,
          conflictName: name,
          actors: [a, b].filter((x): x is string => !!x),
          independentSourceCount: independent,
          partyClaimCount: 0,
          conflictingClaims: null,
          sources: sourceRefs,
          evidence: { independentSources: independent, partyClaims: 0, discoveryLeads: 0, dependentRepeats: 0, official: false, text: approved ? "admin-reviewed" : "under review" },
          deepLink: `/conflict/${c.conflict.slug}`,
          mapTarget,
          watchKeys: [{ type: "conflict", key: c.conflict.slug }, ...geo.map((k) => ({ type: "country", key: k })), ...[c.claimedActorId, c.previousActorId].filter((x): x is string => !!x).flatMap((id) => [{ type: "actor", key: id }, { type: "unit", key: id }])],
          reasons: [approved ? "approved territorial change (reviewed record)" : "reviewed as uncertain; shown as under review, never as a change of control"],
          sig: { magnitude, stateChange: approved ? 100 : 60, scope: 50, kindWeight: approved ? 85 : 65, novel: true },
        },
        range,
      ),
    );
  }

  // Places where two different actors each claim control: shown side by side, no control change asserted.
  const conflictIds = [...new Set(rows.filter((r) => r.status === "approved" || r.status === "uncertain").map((r) => r.conflictId))];
  for (const cid of conflictIds) {
    const groups = await listConflictingClaims(cid);
    if (groups.length === 0) continue;
    const times = new Map(rows.map((r) => [r.id, (r.reviewedAt ?? r.createdAt).getTime()]));
    const conflict = rows.find((r) => r.conflictId === cid)!.conflict;
    for (const g of groups) {
      if (!g.claims.some((cl) => times.has(cl.id))) continue; // no claim in this period
      const geo = conflictGeographyOf(conflict).fighting;
      const at = new Date(Math.max(...g.claims.map((cl) => times.get(cl.id) ?? 0)));
      const parts = g.claims.map((cl) => `${cl.actor?.name ?? "A party"} claims ${trunc(cl.description, 90)}`);
      out.push(
        finish(
          {
            id: `terrclaims:${cid}:${norm(g.location)}`,
            developmentType: "territory_conflicting",
            occurredAt: iso(at),
            firstKnownAt: iso(at),
            lastUpdatedAt: iso(at),
            title: `Conflicting claims over control of ${g.location}`,
            summary: `${parts.join("; ")}. No change of control is recorded while the claims conflict.`,
            previousState: null,
            currentState: "conflicting claims",
            isResolution: false,
            isPartyClaim: false,
            confidence: 0.4,
            confidenceReasons: ["two sides claim control; unresolved"],
            countryCode: geo[0] ?? null,
            geography: { lat: null, lng: null, place: g.location, countryCode: geo[0] ?? null },
            conflictSlug: g.conflictSlug,
            conflictName: conflict.shortName ?? conflict.name,
            actors: g.claims.map((cl) => cl.actor?.name ?? "").filter(Boolean),
            independentSourceCount: g.claims.reduce((s, cl) => s + cl.independentCorroboration, 0),
            partyClaimCount: g.claims.length,
            conflictingClaims: g.claims.map((cl) => ({ actor: cl.actor?.name ?? "A party", text: trunc(cl.description, 160) })),
            sources: g.claims.map((cl) => ({ name: cl.sourceName ?? "Report", url: cl.sourceUrl, role: cl.uncorroborated ? ("party_claim" as const) : ("independent" as const), trustLabel: null })),
            evidence: { independentSources: g.claims.reduce((s, cl) => s + cl.independentCorroboration, 0), partyClaims: g.claims.length, discoveryLeads: 0, dependentRepeats: 0, official: false, text: `${g.claims.length} conflicting claims` },
            deepLink: `/conflict/${g.conflictSlug}`,
            mapTarget: { layers: [], territory: true, at: iso(at) },
            watchKeys: [{ type: "conflict", key: g.conflictSlug }, ...geo.map((k) => ({ type: "country", key: k }))],
            reasons: ["two different actors claim control of the same place"],
            sig: { magnitude: 60, stateChange: 60, scope: 50, kindWeight: 70, novel: true },
          },
          range,
        ),
      );
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Structured events: natural hazards, aviation, maritime, energy, internet
// ---------------------------------------------------------------------------------------------
const CATEGORY_LEDGER: Record<string, string> = { earthquake: "earthquake", weather_alert: "weather_alert", cyclone: "weather_alert", flood: "weather_alert", volcano: "volcano_status", confirmed_wildfire: "wildfire", airport_status: "airport_status", airspace_event: "airspace_event", chokepoint_status: "chokepoint_status", port_disruption: "port_disruption", maritime_incident: "maritime_incident", energy_disruption: "energy_outage", internet_disruption: "internet_outage" };
const TYPE_OF: Record<string, DevelopmentType> = { earthquake: "earthquake", weather_alert: "weather", cyclone: "weather", flood: "weather", volcano: "volcano", confirmed_wildfire: "wildfire", airport_status: "airport", airspace_event: "airspace", chokepoint_status: "chokepoint", port_disruption: "port", maritime_incident: "maritime", energy_disruption: "energy", internet_disruption: "internet" };
const AIRPORT_MAG: Record<string, number> = { closed: 90, partially_closed: 65, disrupted: 25 };
const CHOKE_MAG: Record<string, number> = { closed_restricted: 95, major_disruption: 80, elevated_disruption: 45 };
const RESOLVED = new Set(["resolved", "restored", "normal", "ended", "reopened"]);

interface TransitionRow {
  key: string;
  fromState: string | null;
  toState: string;
  fromValue: number | null;
  toValue: number | null;
  at: Date;
}

async function globalDevelopments(range: BriefRange, excluded: BriefExclusion[]): Promise<BriefDevelopment[]> {
  const inWin = { gte: range.from, lte: range.to };
  const seenFloor = new Date(range.to.getTime() - 3 * 24 * HOUR);
  const trs = await prisma.stateTransition.findMany({ where: { kind: "global", at: { gte: range.from, lte: new Date(range.to.getTime() + 0) } }, orderBy: { at: "asc" }, take: 3000 });
  const trById = new Map<string, TransitionRow[]>();
  for (const t of trs) (trById.get(t.key) ?? trById.set(t.key, []).get(t.key)!).push({ key: t.key, fromState: t.fromState, toState: t.toState, fromValue: t.fromValue, toValue: t.toValue, at: t.at });
  const rows = await prisma.globalEvent.findMany({
    where: {
      category: { not: "thermal_detection" },
      firstSeenAt: { lte: range.to },
      OR: [{ observedAt: inWin }, { firstSeenAt: inWin, observedAt: { gte: seenFloor } }, { id: { in: [...trById.keys()] } }],
    },
    orderBy: { observedAt: "desc" },
    take: 1500,
  });
  const links = rows.length ? await prisma.globalEventLink.findMany({ where: { globalEventId: { in: rows.map((r) => r.id) }, status: "confirmed", conflictId: { not: null } }, select: { globalEventId: true, conflictId: true } }) : [];
  const conflictIds = [...new Set(links.map((l) => l.conflictId!))];
  const conflictSlugs = conflictIds.length ? new Map((await prisma.conflict.findMany({ where: { id: { in: conflictIds } }, select: { id: true, slug: true, name: true, shortName: true } })).map((c) => [c.id, c])) : new Map();
  const sources = new Map((await prisma.source.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.sourceId).filter((x): x is string => !!x))] } } })).map((s) => [s.id, s]));

  const out: BriefDevelopment[] = [];
  for (const r of rows) {
    const d = await globalDevelopment(r, trById.get(r.id) ?? [], range, sources.get(r.sourceId ?? ""), links.filter((l) => l.globalEventId === r.id).map((l) => conflictSlugs.get(l.conflictId!)).filter(Boolean), excluded);
    if (d) out.push(d);
  }
  return out;
}

async function globalDevelopment(r: GlobalEvent, trs: TransitionRow[], range: BriefRange, source: { name: string; independenceClass?: string | null; claimPolicy?: string | null; sourceRole?: string | null; perspective?: string | null } | undefined, linked: { slug: string; name: string; shortName: string | null }[], excluded: BriefExclusion[]): Promise<BriefDevelopment | null> {
  const m = json<Record<string, unknown>>(r.metadata, {});
  const type = TYPE_OF[r.category];
  if (!type) return null;
  const first = trs[0];
  const last = trs.at(-1);
  const isNewInWindow = r.firstSeenAt >= range.from && r.firstSeenAt <= range.to;
  const excl = (reason: string, sig: number | null = null) => {
    excluded.push({ id: `global:${r.id}`, developmentType: type, title: r.title, reason, significance: sig });
    return null;
  };
  const ended = !!r.endedAt || (!!r.expiresAt && r.expiresAt <= range.to);
  const prevState = first?.fromState ?? null;
  const curState = last?.toState ?? (ended ? "resolved" : (r.status ?? null));
  const ledgerType = CATEGORY_LEDGER[r.category]!;
  void ledgerType;

  let magnitude = r.prominence;
  let kindWeight = 55;
  let scope = 40;
  let stateChange = first ? 100 : 60;
  let resolution = false;
  let title = r.title;
  let summary = r.description ? trunc(r.description, 200) : "";
  let prevLabel: string | null = prevState;
  let curLabel: string | null = curState;
  let routine: string | null = null;

  switch (r.category) {
    case "earthquake": {
      const mag = r.severityValue ?? 0;
      const tsunami = m.tsunami === true;
      magnitude = clamp(((mag - 4.5) / 3.5) * 100) + (tsunami ? 20 : 0);
      kindWeight = 60 + (tsunami ? 15 : 0);
      scope = 45;
      if (mag < 5.5 && !tsunami) routine = `Magnitude ${mag.toFixed(1)} is below the briefing threshold (5.5) with no tsunami flag`;
      const place = typeof m.place === "string" ? m.place : null;
      title = `M${mag.toFixed(1)} earthquake${place ? ` — ${place}` : ""}${tsunami ? " (tsunami flag)" : ""}`;
      const km = m.depthKm != null ? `${Math.round(Number(m.depthKm))} km depth` : "depth not reported";
      summary = `M${mag.toFixed(1)} earthquake recorded${place ? ` ${place}` : ""}, ${km}. Tsunami flag: ${tsunami ? "yes" : "no"}.`;
      if (first && first.fromState && first.toState && first.fromState !== first.toState) {
        summary = `Magnitude revised from ${first.fromState.replace("+tsunami", "")} to ${last!.toState.replace("+tsunami", "")}. ${summary}`;
        stateChange = 90;
      }
      break;
    }
    case "weather_alert":
    case "cyclone":
    case "flood": {
      const sev = String(m.severity ?? r.severityLabel ?? "Unknown");
      const gd = String(m.gdacsAlertLevel ?? "");
      if (!["Severe", "Extreme"].includes(sev) && !["Orange", "Red"].includes(gd)) routine = `${gd ? `GDACS ${gd}` : `${sev} severity`} weather alert is below the emergency threshold`;
      if (ended) routine = routine ?? "Weather alert has expired; expiry alone is not a briefing development";
      kindWeight = 55;
      scope = 55;
      summary = `${gd ? `GDACS alert level ${gd}` : `${sev} severity`}${m.certainty ? `, ${String(m.certainty).toLowerCase()} certainty` : ""}. ${typeof m.areaDesc === "string" ? trunc(m.areaDesc, 120) : typeof m.country === "string" ? m.country : ""}`.trim();
      break;
    }
    case "volcano": {
      const level = String(m.alertLevel ?? r.severityLabel ?? "").toUpperCase();
      const rank: Record<string, number> = { NORMAL: 0, ADVISORY: 1, WATCH: 2, WARNING: 3 };
      const down = first && (rank[String(first.toState).toUpperCase()] ?? 1) < (rank[String(first.fromState ?? "").toUpperCase()] ?? 1);
      magnitude = level === "WARNING" ? 95 : level === "WATCH" ? 80 : level === "ADVISORY" ? 45 : 20;
      kindWeight = 65;
      if ((rank[level] ?? 0) < 2 && !first) routine = `Alert level ${level || "unassigned"} is below WATCH`;
      const vol = String(m.volcano ?? r.title);
      title = `${vol}: alert level ${curLabel ?? level}`;
      summary = `${typeof m.observatory === "string" ? m.observatory : "The observatory"} lists ${vol} at alert level ${level || "activity report"} (aviation colour code ${String(m.colorCode ?? "—")}).`;
      if (first && prevLabel) summary = `Alert level moved from ${prevLabel} to ${curLabel}. ${summary}`;
      if (down && curLabel && rank[String(curLabel).toUpperCase()] === 0) {
        resolution = true;
        routine = null;
      }
      break;
    }
    case "confirmed_wildfire":
      magnitude = r.prominence;
      kindWeight = 45;
      scope = 45;
      if (r.prominence < 50) routine = "Reported wildfire below the prominence threshold";
      summary = `Reported wildfire incident${r.severityLabel ? ` (${r.severityLabel})` : ""}; not a raw satellite detection.`;
      break;
    case "airport_status": {
      const status = last?.toState ?? (ended ? "resolved" : (r.status ?? "disrupted"));
      const authority = typeof m.authority === "string" ? m.authority : r.provider;
      const words = status === "closed" ? "closed" : status === "partially_closed" ? "partially closed" : status === "resolved" ? "reopened" : "disrupted";
      kindWeight = 62;
      scope = 30;
      const at = last?.at ?? r.effectiveAt ?? r.providerUpdatedAt ?? r.observedAt;
      if (status === "resolved") {
        resolution = true;
        const was = first?.fromState ?? null;
        if (!was || (AIRPORT_MAG[was] ?? 0) < 60) routine = "Reopening of an airport that was not recorded as closed";
        magnitude = 45;
        title = `${r.title} reopened`;
        summary = `Airport reopened as of ${hhmm(at)}; ${authority} no longer reports a disruption.`;
      } else {
        magnitude = AIRPORT_MAG[status] ?? 25;
        if ((AIRPORT_MAG[status] ?? 0) < 60) routine = `Airport status "${status}" is a disruption, not a closure`;
        title = `${r.title} ${words}`;
        summary = `${r.title} ${words} at ${hhmm(at)} (${first?.fromState ? `was ${first.fromState}` : "status reported"}), per ${authority}.${r.expiresAt ? ` Reported to reopen ${r.expiresAt.toISOString().slice(0, 16).replace("T", " ")} UTC.` : ""}`;
      }
      prevLabel = first?.fromState ?? "normal";
      curLabel = status;
      break;
    }
    case "airspace_event":
      kindWeight = 55;
      scope = 45;
      if (r.prominence < 60) routine = "Airspace notice below the prominence threshold";
      summary = r.description ? trunc(r.description, 200) : `Airspace ${r.status ?? "restriction"} in effect.`;
      break;
    case "chokepoint_status": {
      const status = last?.toState ?? r.status ?? "normal";
      kindWeight = 85;
      scope = 75;
      const dev = Number(m.deviationPct ?? 0);
      if (status === "normal") {
        const was = first?.fromState ?? null;
        if (!was || (CHOKE_MAG[was] ?? 0) < 80) routine = "Traffic normal; the earlier disruption was not major";
        else resolution = true;
        magnitude = 50;
        title = `${r.title} traffic returned toward normal`;
      } else {
        magnitude = CHOKE_MAG[status] ?? 30;
        if ((CHOKE_MAG[status] ?? 0) < 80) routine = `Chokepoint status "${status}" is below major disruption`;
        title = `${r.title}: ${status.replace(/_/g, " ")}`;
      }
      summary = `Transit volume is ${Math.abs(dev)}% ${dev < 0 ? "below" : "above"} its 90-day baseline (aggregate AIS-derived counts; not a closure statement).`;
      prevLabel = first?.fromState ?? "normal";
      curLabel = status;
      break;
    }
    case "port_disruption":
      kindWeight = 50;
      if (r.prominence < 60) routine = "Port hazard note below the prominence threshold";
      summary = "Hazard-derived potential impact on ports; not a confirmed operating status.";
      break;
    case "maritime_incident":
      kindWeight = 55;
      if (r.prominence < 50) routine = "Maritime notice below the prominence threshold";
      break;
    case "energy_disruption": {
      const restored = ended || r.status === "restored";
      const mw = typeof m.capacityAffectedMw === "number" ? m.capacityAffectedMw : typeof m.capacityAffectedMwEquivalent === "number" ? m.capacityAffectedMwEquivalent : null;
      kindWeight = 70;
      scope = 55;
      if (restored) {
        resolution = true;
        const was = first?.fromState ?? null;
        if (!was) routine = "Restoration of an outage that was not recorded in this brief's data";
        magnitude = 50;
        title = `${r.title.replace(/ — .*/, "")} — restored`;
        summary = "The operator no longer reports this capacity as unavailable.";
      } else {
        magnitude = mw != null ? clamp((mw / 2000) * 100) : r.prominence;
        if ((mw ?? 0) < 500 && r.prominence < 50) routine = "Outage below the briefing threshold (500 MW / prominence 50)";
        summary = `Capacity affected: ${r.severityLabel ?? (mw != null ? `${Math.round(mw)} MW` : "not reported")}.${r.expiresAt ? ` Expected restoration ${r.expiresAt.toISOString().slice(0, 16).replace("T", " ")} UTC.` : ""}`;
      }
      break;
    }
    case "internet_disruption": {
      const restored = ended || r.status === "restored";
      kindWeight = 65;
      scope = String(m.scope ?? "") === "national" ? 75 : 40;
      if (restored) {
        resolution = true;
        const was = first?.fromState ?? null;
        if (!was) routine = "Restoration of an anomaly that was not recorded in this brief's data";
        magnitude = 45;
        title = `${r.title.replace(/ — .*/, "")} — connectivity restored`;
        summary = "The measurement no longer shows the anomaly.";
      } else {
        magnitude = r.prominence;
        if (String(m.scope ?? "") !== "national" && r.prominence < 60) routine = "Sub-national or low-prominence anomaly";
        summary = "Observed network anomaly; the measurement does not establish the cause.";
      }
      break;
    }
    default:
      break;
  }

  const official = true;
  const src: BriefSourceRef = { name: source?.name ?? r.provider, url: r.sourceUrl?.trim() ? r.sourceUrl : null, role: "provider", trustLabel: source ? sourceTrust(source).label : null };
  const summaryEv: EvidenceSummary = { independentSources: 0, strongVerification: 0, perspectives: 0, unclassified: 0, partyClaims: 0, discoveryLeads: 0, dependentRepeats: 0 };
  const conf = deriveConfidence({ evidence: summaryEv, official });
  const conflict = linked[0] as { slug: string; name: string; shortName: string | null } | undefined;
  const candidates = await globalCandidates(r, m);
  const occurredAt = last?.at ?? (r.observedAt >= range.from ? r.observedAt : r.firstSeenAt);
  const chg = first && prevLabel !== curLabel ? ` (${prevLabel ?? "?"} → ${curLabel ?? "?"})` : "";
  void chg;
  const draft: Draft = {
    id: `global:${r.id}${last ? `:${last.at.getTime()}` : ""}`,
    developmentType: type,
    occurredAt: iso(occurredAt),
    firstKnownAt: iso(r.firstSeenAt),
    lastUpdatedAt: iso(last?.at ?? r.providerUpdatedAt ?? r.firstSeenAt),
    title,
    summary: `${summary}${summary && !summary.endsWith(".") ? "." : ""} Source: ${src.name} (official / measurement provider).`.trim(),
    previousState: prevLabel,
    currentState: curLabel,
    isResolution: resolution,
    isPartyClaim: false,
    confidence: conf.score,
    confidenceReasons: conf.reasons,
    countryCode: r.countryCode,
    geography: { lat: r.lat, lng: r.lng, place: typeof m.place === "string" ? m.place : null, countryCode: r.countryCode },
    conflictSlug: conflict?.slug ?? null,
    conflictName: conflict ? (conflict.shortName ?? conflict.name) : null,
    actors: [],
    independentSourceCount: 0,
    partyClaimCount: 0,
    conflictingClaims: null,
    sources: [src],
    evidence: { ...evEvidence(summaryEv, true), text: "official / measurement provider" },
    deepLink: `/world?layers=${r.layer}&hazard=${r.id}&focus=${r.lat.toFixed(3)},${r.lng.toFixed(3)},${zoomFor[r.layer] ?? 5}`,
    mapTarget: { layers: [r.layer], hazardId: r.id, lat: r.lat, lng: r.lng, zoom: zoomFor[r.layer] ?? 5, at: iso(occurredAt) },
    watchKeys: candidates.map((c) => ({ type: c.type, key: c.key })),
    reasons: [isNewInWindow && !first ? "new in this period" : first ? `state change ${prevLabel ?? "?"} → ${curLabel ?? "?"}` : "observed in this period"],
    sig: { magnitude: clamp(magnitude), stateChange, scope, kindWeight, novel: isNewInWindow || !!first },
  };
  const dev = finish(draft, range);
  if (routine) return excl(routine, dev.significance);
  if (!isNewInWindow && !first && !(r.observedAt >= range.from)) return excl("No state change in this period", dev.significance);
  return dev;
}

async function claimDevelopments(range: BriefRange): Promise<BriefDevelopment[]> {
  const claims = await prisma.globalEventClaim.findMany({ where: { observedAt: { gte: range.from, lte: range.to } }, include: { globalEvent: true }, orderBy: { observedAt: "desc" }, take: 200 });
  return claims.map((c) => {
    const e = c.globalEvent;
    const conf = deriveConfidence({ evidence: { independentSources: 0, strongVerification: 0, perspectives: 0, unclassified: 0, partyClaims: 1, discoveryLeads: 0, dependentRepeats: 0 } });
    return finish(
      {
        id: `claim:${c.id}`,
        developmentType: "party_claim",
        occurredAt: iso(c.observedAt),
        firstKnownAt: iso(c.createdAt),
        lastUpdatedAt: iso(c.createdAt),
        title: `${c.claimant} claims: ${trunc(c.text, 120)}`,
        summary: `${c.claimant} says: “${trunc(c.text, 200)}” (${c.claimType.replace(/_/g, " ")} claim, ${c.verification}). The status of ${e?.title ?? "the asset"} is unchanged by this claim.`,
        previousState: null,
        currentState: null,
        isResolution: false,
        isPartyClaim: true,
        confidence: Math.min(conf.score, 0.25),
        confidenceReasons: conf.reasons,
        countryCode: e?.countryCode ?? null,
        geography: { lat: e?.lat ?? null, lng: e?.lng ?? null, place: null, countryCode: e?.countryCode ?? null },
        conflictSlug: null,
        conflictName: null,
        actors: [c.claimant],
        independentSourceCount: 0,
        partyClaimCount: 1,
        conflictingClaims: null,
        sources: [{ name: c.sourceName ?? c.claimant, url: c.sourceUrl?.trim() ? c.sourceUrl : null, role: "party_claim", trustLabel: "Party / Aligned Claim" }],
        evidence: { independentSources: 0, partyClaims: 1, discoveryLeads: 0, dependentRepeats: 0, official: false, text: "1 party claim" },
        deepLink: e ? `/world?layers=${e.layer}&hazard=${e.id}&focus=${e.lat.toFixed(3)},${e.lng.toFixed(3)},${zoomFor[e.layer] ?? 5}` : "/world",
        mapTarget: e ? { layers: [e.layer], hazardId: e.id, lat: e.lat, lng: e.lng, zoom: zoomFor[e.layer] ?? 5 } : null,
        watchKeys: e ? [{ type: "layer", key: e.layer }, ...(e.countryCode ? [{ type: "country", key: e.countryCode }] : []), ...(e.entityKey ? [{ type: "watchkey", key: `${e.category}:${e.entityKey}` }] : [])] : [],
        reasons: ["a party's own statement, kept separate from established facts"],
        sig: { magnitude: 50, stateChange: 60, scope: 40, kindWeight: 50, novel: true },
      },
      range,
    );
  });
}

// ---------------------------------------------------------------------------------------------
// Conflict registry: status transitions, new actors, and the escalation / hotspot engines
// ---------------------------------------------------------------------------------------------
export async function buildUniverse(range: BriefRange): Promise<Universe> {
  const excluded: BriefExclusion[] = [];
  const baselineFrom = new Date(range.from.getTime() - BASELINE_MS);
  const conflicts = await prisma.conflict.findMany({ select: { id: true, slug: true, name: true, shortName: true, status: true, lat: true, lng: true, fightingCountries: true, participantCountries: true, supporterCountries: true, geographyBasis: true } });
  const meta: ConflictMeta[] = conflicts.map((c) => ({ id: c.id, slug: c.slug, name: c.shortName ?? c.name, fighting: conflictGeographyOf(c).fighting, status: c.status, lat: c.lat, lng: c.lng }));
  const byId = new Map(meta.map((c) => [c.id, c]));

  // Canonical events: window + the previous 7 days (baseline), plus late-published ones.
  const activityRows = await loadEvents({ occurredAt: { gte: baselineFrom, lte: range.to }, OR: [{ publishedAt: null }, { publishedAt: { lte: range.to } }] }, 4000);
  const lateRows = await loadEvents({ occurredAt: { gte: new Date(range.from.getTime() - 24 * HOUR), lt: range.from }, publishedAt: { gte: range.from, lte: range.to } }, 500);
  const updatedRows = await prisma.eventHistory.findMany({ where: { createdAt: { gte: range.from, lte: range.to }, field: { in: HISTORY_FIELDS } }, select: { eventId: true }, distinct: ["eventId"], take: 500 });
  const haveIds = new Set([...activityRows, ...lateRows].map((e) => e.id));
  const extraIds = updatedRows.map((h) => h.eventId).filter((id) => !haveIds.has(id));
  const updateRows = extraIds.length ? await loadEvents({ id: { in: extraIds } }, 500) : [];
  const inWindowRows = [...activityRows.filter((e) => (e.occurredAt >= range.from && e.occurredAt <= range.to) || e.history.some((h) => h.createdAt >= range.from && h.createdAt <= range.to)), ...lateRows, ...updateRows];
  const { devs: eventDevs, partyHidden } = eventDevelopments([...new Map(inWindowRows.map((e) => [e.id, e])).values()], range, excluded);

  const activity = new Map<string, { label: string; conflictSlug: string | null; country: string | null; events: ActivityEvent[] }>();
  for (const e of activityRows) {
    const conflict = e.conflictId ? byId.get(e.conflictId) : null;
    const key = conflict ? conflict.id : e.countryCode ? `country:${e.countryCode}` : null;
    if (!key) continue;
    const { summary } = reportsFor(e, range.to);
    const partyOnly = summary.independentSources === 0 && summary.partyClaims + summary.discoveryLeads > 0;
    if (partyOnly) continue; // a party's own claim is not an established incident: never feeds the activity model
    const killedRaw = valueAsOf(e, "casualtiesKilled", e.casualtiesKilled == null ? null : String(e.casualtiesKilled), range.to);
    const rec = activity.get(key) ?? activity.set(key, { label: conflict?.name ?? e.countryCode ?? "Unknown", conflictSlug: conflict?.slug ?? null, country: e.countryCode, events: [] }).get(key)!;
    rec.events.push({ id: e.id, at: e.occurredAt.getTime(), severity: valueAsOf(e, "severity", e.severity, range.to) ?? e.severity, importance: e.importance, lat: e.latitude, lng: e.longitude, killed: killedRaw == null || Number.isNaN(Number(killedRaw)) ? null : Number(killedRaw), independent: summary.independentSources, infrastructure: e.eventType === "infrastructure" });
  }

  const [terr, transitions, approvedTimes, claimsTerr, newActorTr] = await Promise.all([
    territoryDevelopments(range, excluded),
    prisma.stateTransition.findMany({ where: { kind: "conflict", at: { gte: range.from, lte: range.to } }, orderBy: { at: "asc" }, take: 1000 }),
    prisma.territorialChangeCandidate.findMany({ where: { status: "approved", OR: [{ reviewedAt: { gte: baselineFrom, lte: range.to } }, { reviewedAt: null, createdAt: { gte: baselineFrom, lte: range.to } }] }, select: { conflictId: true, reviewedAt: true, createdAt: true, status: true } }),
    prisma.territorialChangeCandidate.findMany({ where: { status: { in: ["approved", "uncertain"] }, OR: [{ reviewedAt: { gte: range.from, lte: range.to } }, { reviewedAt: null, createdAt: { gte: range.from, lte: range.to } }] }, select: { conflictId: true } }),
    Promise.resolve(null),
  ]);
  void newActorTr;

  // Conflict-level developments from the transition ledger.
  const confDevs: BriefDevelopment[] = [];
  const perConflictTr = new Map<string, ConflictTransition[]>();
  for (const t of transitions) {
    const c = byId.get(t.key);
    if (!c) continue;
    const list = perConflictTr.get(c.id) ?? perConflictTr.set(c.id, []).get(c.id)!;
    if (t.alertType === "conflict_status") {
      list.push({ kind: "status", at: t.at.getTime(), from: t.fromState, to: t.toState });
      const down = ["reduced", "dormant", "ended", "resolved", "archived"].includes(t.toState);
      confDevs.push(finish({ id: `cstatus:${t.id}`, developmentType: "conflict_status", occurredAt: iso(t.at), firstKnownAt: iso(t.at), lastUpdatedAt: iso(t.at), title: `${c.name}: status ${t.fromState ?? "?"} → ${t.toState}`, summary: `The conflict registry status changed from ${t.fromState ?? "unknown"} to ${t.toState}.`, previousState: t.fromState, currentState: t.toState, isResolution: down, isPartyClaim: false, confidence: 0.85, confidenceReasons: ["registry record"], countryCode: c.fighting[0] ?? null, geography: { lat: c.lat, lng: c.lng, place: null, countryCode: c.fighting[0] ?? null }, conflictSlug: c.slug, conflictName: c.name, actors: [], independentSourceCount: 0, partyClaimCount: 0, conflictingClaims: null, sources: [], evidence: { independentSources: 0, partyClaims: 0, discoveryLeads: 0, dependentRepeats: 0, official: false, text: "registry record" }, deepLink: `/conflict/${c.slug}`, mapTarget: c.lat != null && c.lng != null ? { layers: [], lat: c.lat, lng: c.lng, zoom: 5 } : null, watchKeys: [{ type: "conflict", key: c.slug }, ...c.fighting.map((k) => ({ type: "country", key: k }))], reasons: [down ? "conflict status reduced" : "conflict status raised"], sig: { magnitude: down ? 65 : 75, stateChange: 100, scope: 60, kindWeight: 80, novel: true } }, range));
    } else if (t.alertType === "conflict_escalation") {
      list.push({ kind: "severity", at: t.at.getTime(), from: t.fromState, to: t.toState });
    } else if (t.alertType === "new_actor") {
      list.push({ kind: "actor", at: t.at.getTime(), from: null, to: "new actor" });
      const added = (json<{ added?: string[] }>(t.data, {}).added ?? []) as string[];
      const unitIds = added.filter((a) => a.startsWith("unit:")).map((a) => a.slice(5));
      const units = unitIds.length ? await prisma.militaryUnit.findMany({ where: { id: { in: unitIds } }, select: { id: true, name: true } }) : [];
      const names = [...added.filter((a) => a.startsWith("name:")).map((a) => a.slice(5)), ...units.map((u) => u.name)];
      confDevs.push(finish({ id: `cactor:${t.id}`, developmentType: "actor_involvement", occurredAt: iso(t.at), firstKnownAt: iso(t.at), lastUpdatedAt: iso(t.at), title: `New actor in ${c.name}: ${names.join(", ") || "recorded"}`, summary: `${names.join(", ") || "A new actor"} is now recorded as involved in ${c.name}.`, previousState: null, currentState: names.join(", "), isResolution: false, isPartyClaim: false, confidence: 0.8, confidenceReasons: ["registry record"], countryCode: c.fighting[0] ?? null, geography: { lat: c.lat, lng: c.lng, place: null, countryCode: c.fighting[0] ?? null }, conflictSlug: c.slug, conflictName: c.name, actors: names, independentSourceCount: 0, partyClaimCount: 0, conflictingClaims: null, sources: [], evidence: { independentSources: 0, partyClaims: 0, discoveryLeads: 0, dependentRepeats: 0, official: false, text: "registry record" }, deepLink: `/conflict/${c.slug}`, mapTarget: c.lat != null && c.lng != null ? { layers: [], lat: c.lat, lng: c.lng, zoom: 5 } : null, watchKeys: [{ type: "conflict", key: c.slug }, ...c.fighting.map((k) => ({ type: "country", key: k })), ...unitIds.flatMap((id) => [{ type: "actor", key: id }, { type: "unit", key: id }])], reasons: ["a new actor entered the conflict record"], sig: { magnitude: 55, stateChange: 90, scope: 55, kindWeight: 65, novel: true } }, range));
    }
  }

  // Escalation trend per conflict (canonical activity only) and emerging hotspots.
  const escalation: EscalationAssessment[] = [];
  const hotspots: HotspotAssessment[] = [];
  const terrByConflict = new Map<string, number[]>();
  for (const t of approvedTimes) (terrByConflict.get(t.conflictId) ?? terrByConflict.set(t.conflictId, []).get(t.conflictId)!).push((t.reviewedAt ?? t.createdAt).getTime());
  const claimsByConflict = new Map<string, number>();
  for (const t of claimsTerr) claimsByConflict.set(t.conflictId, (claimsByConflict.get(t.conflictId) ?? 0) + 1);
  const activityKeys = new Set([...activity.keys(), ...perConflictTr.keys(), ...terrByConflict.keys()]);
  for (const key of activityKeys) {
    const c = byId.get(key);
    const a = activity.get(key);
    if (c) {
      const tr = perConflictTr.get(c.id) ?? [];
      const assessment = assessEscalation({ conflictSlug: c.slug, conflictName: c.name, from: range.from.getTime(), to: range.to.getTime(), events: a?.events ?? [], transitions: tr, territorialChanges: terrByConflict.get(c.id) ?? [] });
      escalation.push(assessment);
      if (assessment.trend === "escalating" || assessment.trend === "de-escalating") {
        const up = assessment.trend === "escalating";
        confDevs.push(finish({ id: `${up ? "esc" : "deesc"}:${c.id}:${range.from.getTime()}`, developmentType: up ? "escalation" : "de_escalation", occurredAt: iso(range.to), firstKnownAt: iso(range.to), lastUpdatedAt: iso(range.to), title: `${c.name}: ${up ? "escalation indicators increased" : "de-escalation indicators increased"}`, summary: `${assessment.reasons.slice(0, 3).join("; ")}. Assessed from recorded incidents and state changes, not from reporting volume.`, previousState: null, currentState: assessment.trend, isResolution: !up, isPartyClaim: false, confidence: assessment.confidence, confidenceReasons: [`${assessment.metrics.windowEvents} incidents in period, ${assessment.metrics.baselineEvents} in the previous 7 days`], countryCode: c.fighting[0] ?? null, geography: { lat: c.lat, lng: c.lng, place: null, countryCode: c.fighting[0] ?? null }, conflictSlug: c.slug, conflictName: c.name, actors: [], independentSourceCount: 0, partyClaimCount: 0, conflictingClaims: null, sources: [], evidence: { independentSources: 0, partyClaims: 0, discoveryLeads: 0, dependentRepeats: 0, official: false, text: "derived from recorded incidents" }, deepLink: `/conflict/${c.slug}`, mapTarget: c.lat != null && c.lng != null ? { layers: [], lat: c.lat, lng: c.lng, zoom: 5 } : null, watchKeys: [{ type: "conflict", key: c.slug }, ...c.fighting.map((k) => ({ type: "country", key: k }))], reasons: assessment.signals.slice(0, 4).map((s) => `${s.name}: ${s.detail}`), sig: { magnitude: 40 + Math.abs(assessment.score) * 0.6, stateChange: 60, scope: 60, kindWeight: 70, novel: true } }, range));
      }
    }
    if (a) {
      const hs = assessHotspot({ key, label: a.label, conflictSlug: a.conflictSlug, countryCode: a.country ?? c?.fighting[0] ?? null, from: range.from.getTime(), to: range.to.getTime(), events: a.events, territorialClaims: c ? (claimsByConflict.get(c.id) ?? 0) : 0, newActors: c ? (perConflictTr.get(c.id) ?? []).filter((t) => t.kind === "actor").length : 0 });
      if (hs) hotspots.push(hs);
    } else if (c && (claimsByConflict.get(c.id) ?? 0) > 0) {
      const hs = assessHotspot({ key, label: c.name, conflictSlug: c.slug, countryCode: c.fighting[0] ?? null, from: range.from.getTime(), to: range.to.getTime(), events: [], territorialClaims: claimsByConflict.get(c.id) ?? 0, newActors: (perConflictTr.get(c.id) ?? []).filter((t) => t.kind === "actor").length });
      if (hs) hotspots.push(hs);
    }
  }
  hotspots.sort((x, y) => y.score - x.score || x.key.localeCompare(y.key));

  const [globalDevs, claimDevs] = await Promise.all([globalDevelopments(range, excluded), claimDevelopments(range)]);

  // Inclusion: routine observations are dropped; territorial / trend / registry developments come from
  // thresholded detectors and are always kept; everything else must clear the significance threshold.
  const ALWAYS: DevelopmentType[] = ["territory_changed", "territory_under_review", "territory_conflicting", "escalation", "de_escalation", "conflict_status", "actor_involvement"];
  const kept: BriefDevelopment[] = [];
  for (const d of [...eventDevs, ...terr, ...confDevs, ...globalDevs, ...claimDevs]) {
    if (d.isPartyClaim || ALWAYS.includes(d.developmentType) || d.significance >= MIN_SIGNIFICANCE) kept.push(d);
    else excluded.push({ id: d.id, developmentType: d.developmentType, title: d.title, reason: `Below significance threshold (${d.significance} < ${MIN_SIGNIFICANCE}): ${d.significanceReasons.join(", ")}`, significance: d.significance });
  }
  // One development per id (a story may be reached through more than one path).
  const unique = [...new Map(kept.map((d) => [d.id, d])).values()];
  void sevRank;
  return { range: { from: iso(range.from), to: iso(range.to), window: range.window, live: range.live }, developments: unique, excluded, escalation, hotspots, conflicts: meta, hiddenPartyClaims: partyHidden + claimDevs.length };
}
