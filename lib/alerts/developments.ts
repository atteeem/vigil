import type { GlobalEvent } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { sourceTrust, summarizeEvidence } from "@/lib/sources/trust";
import { scoreConflict } from "@/lib/db/repositories/scoring";
import { listConflictingClaims } from "@/lib/public/claims";
import { conflictGeographyOf } from "@/lib/registry/geography";
import { recordTransition, stepLedger } from "./ledger";
import { GDACS_AS_CAP, type Candidate, type Development, type Facts } from "./decide";
import type { AlertType } from "./types";

// Derives DEVELOPMENTS — meaningful state changes — from the existing systems (conflict events,
// approved territorial changes, GlobalEvents, party claims). Nothing here creates events or a new
// ingestion path: it reads what is already stored, compares it with the state ledger, and returns a
// development only when something material changed. Repeated reports, dependent sources and
// irrelevant provider revisions produce nothing.

const SEV_SCORE: Record<string, number> = { stable: 10, guarded: 30, elevated: 50, high: 70, severe: 85, extreme: 95 };
const SEV_ORDER = ["stable", "guarded", "elevated", "high", "severe", "extreme"];
const sevRank = (s: string) => Math.max(0, SEV_ORDER.indexOf(s));

const json = <T,>(s: string | null | undefined, fallback: T): T => {
  try {
    return s ? (JSON.parse(s) as T) : fallback;
  } catch {
    return fallback;
  }
};
const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const cand = (type: Candidate["type"], key: string | null | undefined, specificity: number): Candidate[] => (key ? [{ type, key, specificity }] : []);
const iso = (d: Date | null | undefined) => d?.toISOString() ?? null;

export interface DeriveOptions {
  /** false = simulation: the ledger is only read. */
  commit: boolean;
  /** Simulation: treat the current state as a fresh development even if it was already announced. */
  force?: boolean;
}

// ---------------------------------------------------------------------------------------------
// Conflict events
// ---------------------------------------------------------------------------------------------
export async function deriveFromEvent(eventId: string, opts: DeriveOptions): Promise<Development[]> {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: { conflict: true, sources: { include: { rawIngestionItem: { include: { source: true } } } }, militaryUnitLinks: { select: { unitId: true } } },
  });
  if (!event || !event.published || event.origin !== "conflict_news") return [];

  const summary = summarizeEvidence(event.sources.map((s) => ({ sourceId: s.rawIngestionItem.source.id, url: s.rawIngestionItem.originalUrl, trust: sourceTrust(s.rawIngestionItem.source), relay: s.relationship === "relay" })));
  const partyOnly = summary.independentSources === 0 && summary.partyClaims + summary.discoveryLeads > 0;
  const evidence = partyOnly ? "party" : "reported";
  const claimant = event.sources.map((s) => s.rawIngestionItem.source).find((s) => sourceTrust(s).category === "party_claim" || sourceTrust(s).category === "discovery");
  const killed = event.casualtiesKilled ?? 0;

  const step = await stepLedger({
    kind: "event",
    key: event.id,
    alertType: "conflict_event",
    state: `${evidence}|${event.severity}`,
    value: killed,
    data: { severity: event.severity, killed, independent: summary.independentSources, evidence },
    commit: opts.commit, force: opts.force,
    material: (prev) => {
      const pe = String(prev.data?.evidence ?? prev.state.split("|")[0]);
      const psev = String(prev.data?.severity ?? prev.state.split("|")[1] ?? "");
      const pk = Number(prev.data?.killed ?? 0);
      if (pe === "party" && evidence === "reported") return true; // independently corroborated
      if (evidence === "reported" && sevRank(event.severity) > sevRank(psev)) return true; // meaningfully more severe
      // Casualty estimate changes substantially AND is better corroborated (two independent groups).
      if (evidence === "reported" && summary.independentSources >= 2 && killed >= Math.max(10, pk * 1.5) && killed > pk) return true;
      return false; // another source repeating the same account, edits, metadata
    },
  });
  if (!step.changed) return partyOnly ? [] : await deriveEscalation(event.conflictId, opts);

  const prevData = step.prev?.data ?? null;
  const corroborated = !!prevData && prevData.evidence === "party" && evidence === "reported";
  const escalated = !!prevData && !corroborated && sevRank(event.severity) > sevRank(String(prevData.severity ?? ""));
  const casualty = !!prevData && !corroborated && !escalated;
  const conflictSlug = event.conflict?.slug ?? null;
  const geo = event.conflict ? conflictGeographyOf(event.conflict).fighting : [];
  const importance = event.importance;
  const sevScore = SEV_SCORE[event.severity] ?? 30;
  const prefix = corroborated ? "Now independently reported: " : escalated ? "Escalated: " : casualty ? "Casualty estimate revised: " : "";
  const isParty = evidence === "party";
  const who = claimant ? (claimant.perspective || claimant.name) : "A party";
  const evidenceText = isParty ? "Unverified: reported only by party / aligned or discovery sources" : `${summary.independentSources} independent source${summary.independentSources === 1 ? "" : "s"}`;

  const candidates: Candidate[] = [
    ...cand("conflict", conflictSlug, 1),
    ...cand("country", event.countryCode, 0.6),
    ...geo.flatMap((c) => cand("country", c, 0.6)),
    ...event.militaryUnitLinks.flatMap((l) => [...cand("actor", l.unitId, 0.9), ...cand("unit", l.unitId, 0.9)]),
  ];
  return [
    {
      signalKind: "event",
      signalRef: event.id,
      alertType: isParty ? "party_claim" : "conflict_event",
      ruleType: "conflict_event",
      ledgerKind: "event",
      ledgerKey: event.id,
      state: `${evidence}|${event.severity}${killed ? `|k${killed}` : ""}`,
      version: step.version,
      isResolution: false,
      isPartyClaim: isParty,
      significance: Math.round(0.6 * importance + 0.4 * sevScore),
      confidence: isParty ? 0.25 : Math.min(1, 0.45 + 0.2 * summary.independentSources),
      title: isParty ? `${who} claims: ${event.title}` : `${prefix}${event.title}`,
      summary: `${event.summary.slice(0, 220)}${event.summary.length > 220 ? "…" : ""} ${evidenceText}.`,
      candidates,
      facts: { conflictId: event.conflictId, conflictSlug, eventImportance: importance, eventSeverityScore: sevScore, eventCountry: event.countryCode, conflictCountries: geo },
      deepLink: `/event/${event.slug}`,
      snapshot: { kind: "event", eventId: event.id, slug: event.slug, title: event.title, severity: event.severity, importance, verificationStatus: event.verificationStatus, killed: event.casualtiesKilled, injured: event.casualtiesInjured, evidence: { independentSources: summary.independentSources, partyClaims: summary.partyClaims, discoveryLeads: summary.discoveryLeads, dependentRepeats: summary.dependentRepeats }, occurredAt: iso(event.occurredAt), locationName: event.locationName, at: new Date().toISOString() },
      eventId: event.id,
      conflictSlug,
      changeNote: corroborated ? "Independent reporting now supports a previously party-only claim" : escalated ? `Severity rose from ${String(prevData?.severity)} to ${event.severity}` : casualty ? `Reported deaths rose from ${String(prevData?.killed)} to ${killed} with ${summary.independentSources} independent sources` : null,
    },
    ...(isParty ? [] : await deriveEscalation(event.conflictId, opts)),
  ];
}

/** Conflict-level escalation: the conflict's severity band rises (or its score jumps). First sight is only a baseline. */
export async function deriveEscalation(conflictId: string | null | undefined, opts: DeriveOptions): Promise<Development[]> {
  if (!conflictId) return [];
  const scores = await scoreConflict(conflictId);
  const conflict = await prisma.conflict.findUnique({ where: { id: conflictId } });
  if (!scores || !conflict) return [];
  const score = scores.severity.severityScore;
  const label = scores.severity.severityLabel;
  const step = await stepLedger({
    kind: "conflict",
    key: conflict.id,
    alertType: "conflict_escalation",
    state: label,
    value: score,
    commit: opts.commit, force: opts.force,
    baselineOnly: true,
    material: (prev) => sevRank(label) > sevRank(prev.state) || score >= (prev.value ?? 0) + 10,
  });
  if (!step.changed || !step.prev) return [];
  const geo = conflictGeographyOf(conflict).fighting;
  return [
    {
      signalKind: "conflict",
      signalRef: conflict.id,
      alertType: "conflict_escalation",
      ruleType: "conflict_escalation",
      ledgerKind: "conflict",
      ledgerKey: conflict.id,
      state: label,
      version: step.version,
      isResolution: false,
      isPartyClaim: false,
      significance: score,
      confidence: 0.75,
      title: `Escalation in ${conflict.shortName ?? conflict.name}`,
      summary: `Severity moved from ${step.prev.state} (${Math.round(step.prev.value ?? 0)}) to ${label} (${score}). ${scores.severity.reasons.slice(0, 2).join(" ")}`.trim(),
      candidates: [...cand("conflict", conflict.slug, 1), ...geo.flatMap((c) => cand("country", c, 0.6))],
      facts: { conflictId: conflict.id, conflictSlug: conflict.slug, conflictSeverityScore: score, conflictCountries: geo },
      deepLink: `/conflict/${conflict.slug}`,
      snapshot: { kind: "conflict", conflictId: conflict.id, slug: conflict.slug, severityScore: score, severityLabel: label, previousLabel: step.prev.state, previousScore: step.prev.value, reasons: scores.severity.reasons.slice(0, 4), at: new Date().toISOString() },
      conflictSlug: conflict.slug,
      changeNote: `Severity ${step.prev.state} → ${label}`,
    },
  ];
}

/** Conflict status change and new actor involvement (called when a conflict record is edited). */
export async function deriveConflictChange(conflictId: string, opts: DeriveOptions): Promise<Development[]> {
  const conflict = await prisma.conflict.findUnique({ where: { id: conflictId }, include: { actors: { select: { name: true } }, participants: { select: { unitId: true } } } });
  if (!conflict) return [];
  const out: Development[] = [];
  const geo = conflictGeographyOf(conflict).fighting;
  const base = { signalKind: "conflict" as const, signalRef: conflict.id, isResolution: false, isPartyClaim: false, confidence: 0.85, conflictSlug: conflict.slug, deepLink: `/conflict/${conflict.slug}`, candidates: [...cand("conflict", conflict.slug, 1), ...geo.flatMap((c) => cand("country", c, 0.6))], facts: { conflictId: conflict.id, conflictSlug: conflict.slug, conflictCountries: geo } as Facts };

  const st = await stepLedger({ kind: "conflict", key: conflict.id, alertType: "conflict_status", state: conflict.status, commit: opts.commit, force: opts.force, baselineOnly: true });
  if (st.changed && st.prev)
    out.push({ ...base, alertType: "conflict_status", ruleType: "conflict_status", ledgerKind: "conflict", ledgerKey: conflict.id, state: conflict.status, version: st.version, significance: 70, title: `${conflict.shortName ?? conflict.name}: status is now ${conflict.status}`, summary: `Status changed from ${st.prev.state} to ${conflict.status}.`, snapshot: { kind: "conflict", conflictId: conflict.id, slug: conflict.slug, status: conflict.status, previousStatus: st.prev.state, at: new Date().toISOString() }, changeNote: `${st.prev.state} → ${conflict.status}` });

  const actorIds = [...conflict.actors.map((a) => `name:${a.name}`), ...conflict.participants.map((p) => `unit:${p.unitId}`)].sort();
  const known = await prisma.alertState.findUnique({ where: { kind_key_alertType: { kind: "conflict", key: conflict.id, alertType: "new_actor" } } });
  const knownIds = new Set<string>(json<string[]>(known?.data, []));
  const added = actorIds.filter((id) => !knownIds.has(id));
  if (known && added.length > 0) {
    const units = await prisma.militaryUnit.findMany({ where: { id: { in: added.filter((a) => a.startsWith("unit:")).map((a) => a.slice(5)) } }, select: { name: true } });
    const names = [...added.filter((a) => a.startsWith("name:")).map((a) => ({ name: a.slice(5) })), ...units];
    out.push({ ...base, alertType: "new_actor", ruleType: "new_actor", ledgerKind: "conflict", ledgerKey: conflict.id, state: `actors:${actorIds.join(",")}`, version: (known.version ?? 1) + 1, significance: 55, title: `New actor in ${conflict.shortName ?? conflict.name}: ${names.map((n) => n.name).join(", ")}`, summary: "A new actor is now recorded as involved in this conflict.", snapshot: { kind: "conflict", conflictId: conflict.id, slug: conflict.slug, addedActors: names.map((n) => n.name), at: new Date().toISOString() }, changeNote: null });
  }
  if (opts.commit && known && added.length > 0) {
    await recordTransition({ kind: "conflict", key: conflict.id, alertType: "new_actor", fromState: known.state, toState: `actors:${actorIds.join(",")}`, material: true, data: { added } });
  }
  if (opts.commit && (!known || added.length > 0 || knownIds.size !== actorIds.length)) {
    await prisma.alertState.upsert({ where: { kind_key_alertType: { kind: "conflict", key: conflict.id, alertType: "new_actor" } }, update: { state: `actors:${actorIds.join(",")}`, data: JSON.stringify(actorIds), version: added.length > 0 && known ? known.version + 1 : (known?.version ?? 1) }, create: { kind: "conflict", key: conflict.id, alertType: "new_actor", state: `actors:${actorIds.join(",")}`, data: JSON.stringify(actorIds), version: 1 } });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Territorial change intelligence
// ---------------------------------------------------------------------------------------------
export async function deriveFromTerritorialChange(candidateId: string, opts: DeriveOptions): Promise<Development[]> {
  const c = await prisma.territorialChangeCandidate.findUnique({ where: { id: candidateId }, include: { conflict: true, claimedActor: { select: { name: true } }, previousActor: { select: { name: true } } } });
  if (!c) return [];
  const out: Development[] = [];
  const geo = conflictGeographyOf(c.conflict).fighting;
  const conflictCands = [...cand("conflict", c.conflict.slug, 1), ...geo.flatMap((k) => cand("country", k, 0.6))];

  // Only an APPROVED change is announced as a change ("captured" needs review and independent evidence).
  if (c.status === "approved") {
    const step = await stepLedger({ kind: "territorial", key: c.id, alertType: "territorial_change", state: "approved", commit: opts.commit, force: opts.force });
    if (step.changed) {
      const verb = { captured: "captured", withdrawn: "withdrew from", transferred: "transferred", contested: "contested", control_uncertain: "uncertain control of" }[c.changeType] ?? "changed";
      const where = c.locationName ?? "an area";
      out.push({
        signalKind: "territorial_change",
        signalRef: c.id,
        alertType: "territorial_change",
        ruleType: "territorial_change",
        ledgerKind: "territorial",
        ledgerKey: c.id,
        state: "approved",
        version: step.version,
        isResolution: false,
        isPartyClaim: false,
        significance: c.changeType === "captured" || c.changeType === "transferred" ? 72 : 55,
        confidence: 0.85,
        title: `Territorial change in ${c.conflict.shortName ?? c.conflict.name}: ${where}`,
        summary: `${c.claimedActor?.name ? `${c.claimedActor.name} ${verb} ${where}` : c.description}. Reviewed and approved with independent evidence.`,
        candidates: [...conflictCands, ...cand("actor", c.claimedActorId, 0.9), ...cand("unit", c.claimedActorId, 0.9), ...cand("actor", c.previousActorId, 0.9), ...cand("unit", c.previousActorId, 0.9)],
        facts: { conflictId: c.conflictId, conflictSlug: c.conflict.slug, conflictCountries: geo },
        deepLink: `/conflict/${c.conflict.slug}`,
        snapshot: { kind: "territorial_change", candidateId: c.id, conflict: c.conflict.slug, description: c.description, changeType: c.changeType, location: c.locationName, claimedActor: c.claimedActor?.name ?? null, previousActor: c.previousActor?.name ?? null, confidence: c.confidence, sourceName: c.sourceName, sourceUrl: c.sourceUrl, observedAt: iso(c.observedAt), at: new Date().toISOString() },
        conflictSlug: c.conflict.slug,
      });
    }
  }

  // Conflicting claims: two or more different actors claiming the same place is itself a development —
  // announced as a disagreement, never as "captured".
  if (c.status === "approved" || c.status === "uncertain") {
    for (const g of await listConflictingClaims(c.conflictId)) {
      const actors = g.claims.map((x) => x.actor?.name).filter((n): n is string => !!n);
      const uniq = [...new Set(actors)].sort();
      if (uniq.length < 2) continue;
      const key = `${c.conflictId}:${norm(g.location)}`;
      const step = await stepLedger({ kind: "claims", key, alertType: "conflicting_claims", state: uniq.join("|"), commit: opts.commit, force: opts.force, material: (prev) => uniq.length > prev.state.split("|").length });
      if (!step.changed) continue;
      out.push({
        signalKind: "territorial_change",
        signalRef: c.id,
        alertType: "conflicting_claims",
        ruleType: "conflicting_claims",
        ledgerKind: "claims",
        ledgerKey: key,
        state: uniq.join("|"),
        version: step.version,
        isResolution: false,
        isPartyClaim: false,
        significance: 60,
        confidence: 0.6,
        title: `Conflicting territorial claims reported in ${g.location}`,
        summary: `${uniq.join(" and ")} each claim control of ${g.location}. No conclusion is drawn while the claims conflict.`,
        candidates: conflictCands,
        facts: { conflictId: c.conflictId, conflictSlug: c.conflict.slug, conflictCountries: geo },
        deepLink: `/conflict/${c.conflict.slug}`,
        snapshot: { kind: "conflicting_claims", conflict: c.conflict.slug, location: g.location, claimants: uniq, claims: g.claims.map((x) => ({ actor: x.actor?.name ?? null, changeType: x.changeType, uncorroborated: x.uncorroborated, sourceUrl: x.sourceUrl })), at: new Date().toISOString() },
        conflictSlug: c.conflict.slug,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// GlobalEvents (natural hazards, aviation, maritime, energy, internet)
// ---------------------------------------------------------------------------------------------
const ZOOM: Record<string, number> = { earthquakes: 6, fires: 7, weather: 5, volcanoes: 8, aviation: 7, maritime: 6, energy: 5, internet: 4 };
const AIRPORT_RANK: Record<string, number> = { normal: 0, disrupted: 1, partially_closed: 2, closed: 3 };
const CHOKE_RANK: Record<string, number> = { normal: 0, elevated_disruption: 1, major_disruption: 2, closed_restricted: 3 };
const VOLC_RANK: Record<string, number> = { NORMAL: 0, ADVISORY: 1, WATCH: 2, WARNING: 3 };
const CAP_RANK: Record<string, number> = { Unknown: 0, Minor: 1, Moderate: 2, Severe: 3, Extreme: 4 };

const mapLinks = (r: Pick<GlobalEvent, "id" | "layer" | "lat" | "lng">, at?: Date) => {
  const base = `/world?layers=${r.layer}&hazard=${r.id}&focus=${r.lat.toFixed(3)},${r.lng.toFixed(3)},${ZOOM[r.layer] ?? 5}`;
  return { deepLink: base, snapshotLink: at ? `${base}&at=${encodeURIComponent(at.toISOString())}` : null };
};

export async function globalCandidates(r: GlobalEvent, m: Record<string, unknown>): Promise<Candidate[]> {
  const list: Candidate[] = [...cand("layer", r.layer, 0.4), ...cand("country", r.countryCode, 0.6)];
  if (r.entityKey) list.push({ type: "watchkey", key: `${r.category}:${r.entityKey}`, specificity: 1 });
  if (r.category === "airport_status") list.push(...cand("airport", r.entityKey, 1));
  if (r.category === "airspace_event" && typeof m.icaoLocation === "string") list.push(...cand("airport", m.icaoLocation, 0.9));
  if (r.category === "chokepoint_status") list.push(...cand("chokepoint", r.entityKey, 1));
  if (r.category === "volcano") list.push(...cand("volcano", r.entityKey, 1));
  if (r.category === "port_disruption" && typeof m.affectedPorts === "string") for (const p of String(m.affectedPorts).split(/[;,]/)) if (norm(p)) list.push({ type: "port", key: norm(p), specificity: 1 });
  return list;
}

/** The trust label of the provider, as a short evidence line ("USGS Earthquake Hazards Program — official source"). */
async function providerEvidence(r: GlobalEvent): Promise<{ text: string; label: string | null }> {
  const src = r.sourceId ? await prisma.source.findUnique({ where: { id: r.sourceId } }) : null;
  return { text: `${src?.name ?? r.provider} (official / measurement provider)`, label: src ? sourceTrust(src).label : null };
}

export async function deriveFromGlobalEvent(id: string, opts: DeriveOptions, now: Date = new Date()): Promise<Development[]> {
  const r = await prisma.globalEvent.findUnique({ where: { id } });
  return r ? deriveFromGlobalRow(r, opts, now) : [];
}

export async function deriveFromGlobalRow(r: GlobalEvent, opts: DeriveOptions, now: Date = new Date()): Promise<Development[]> {
  if (r.category === "thermal_detection") return []; // raw detections never scan watches
  const m = json<Record<string, unknown>>(r.metadata, {});
  const ended = !!r.endedAt || (!!r.expiresAt && r.expiresAt <= now);
  const ev = await providerEvidence(r);
  const candidates = await globalCandidates(r, m);
  const links = mapLinks(r, r.providerUpdatedAt ?? r.observedAt);
  const base = { signalKind: "global_event" as const, signalRef: r.id, ledgerKind: "global", ledgerKey: r.id, isPartyClaim: false, confidence: 0.85, candidates, globalEventId: r.id, deepLink: links.deepLink, snapshotLink: links.snapshotLink };
  const snap = (extra: Record<string, unknown>) => ({ kind: "global_event", globalEventId: r.id, category: r.category, layer: r.layer, provider: r.provider, providerEventId: r.providerEventId, title: r.title, status: r.status, severityLabel: r.severityLabel, severityValue: r.severityValue, prominence: r.prominence, observedAt: iso(r.observedAt), providerUpdatedAt: iso(r.providerUpdatedAt), expiresAt: iso(r.expiresAt), endedAt: iso(r.endedAt), revision: r.revision, sourceUrl: r.sourceUrl, evidence: { sources: 1, text: ev.text, trust: ev.label }, at: now.toISOString(), ...extra });
  const facts = (extra: Facts): Facts => ({ layer: r.layer, countryCode: r.countryCode, ...extra });
  const tail = ` Source: ${ev.text}.`;

  const finish = (alertType: AlertType, ruleType: AlertType, state: string, version: number, isResolution: boolean, significance: number, title: string, summary: string, f: Facts, note: string | null, extra: Record<string, unknown> = {}): Development => ({ ...base, alertType, ruleType, state, version, isResolution, significance, title, summary: summary + tail, facts: facts(f), snapshot: snap(extra), changeNote: note });

  switch (r.category) {
    case "earthquake": {
      const mag = r.severityValue ?? 0;
      const tsunami = m.tsunami === true;
      const step = await stepLedger({ kind: "global", key: r.id, alertType: "earthquake", state: `M${mag.toFixed(1)}${tsunami ? "+tsunami" : ""}`, value: mag, data: { tsunami }, commit: opts.commit, force: opts.force, material: (p) => Math.abs(mag - (p.value ?? mag)) >= 0.3 || (tsunami && p.data?.tsunami !== true) });
      if (!step.changed) return [];
      const revised = step.prev ? `Revised from M${(step.prev.value ?? 0).toFixed(1)} to M${mag.toFixed(1)}. ` : "";
      return [finish("earthquake", "earthquake", `M${mag.toFixed(1)}${tsunami ? "+tsunami" : ""}`, step.version, false, r.prominence, `M${mag.toFixed(1)} earthquake${typeof m.place === "string" ? ` — ${m.place}` : ""}`, `${revised}Depth ${m.depthKm != null ? Math.round(Number(m.depthKm)) : "?"} km. Tsunami flag: ${tsunami ? "yes" : "no"}. ${r.confidenceLabel ?? ""}.`, { magnitude: mag, tsunami }, step.prev ? `Magnitude revised M${(step.prev.value ?? 0).toFixed(1)} → M${mag.toFixed(1)}` : null, { magnitude: mag, tsunami, depthKm: m.depthKm ?? null })];
    }
    case "weather_alert":
    case "cyclone":
    case "flood": {
      const sev = r.category === "weather_alert" ? String(m.severity ?? r.severityLabel ?? "Unknown") : (GDACS_AS_CAP[String(m.gdacsAlertLevel ?? "")] ?? "Minor");
      const cert = String(m.certainty ?? "Unknown");
      const state = ended ? "ended" : `${sev}/${cert}`;
      const step = await stepLedger({ kind: "global", key: r.id, alertType: "weather_alert", state, value: CAP_RANK[sev] ?? 0, data: { cert }, commit: opts.commit, force: opts.force, material: (p) => ended || (CAP_RANK[sev] ?? 0) > (p.value ?? 0) || (m.certainty && ["Unknown", "Unlikely", "Possible", "Likely", "Observed"].indexOf(cert) > ["Unknown", "Unlikely", "Possible", "Likely", "Observed"].indexOf(String(p.data?.cert ?? "Unknown"))) as boolean });
      if (!step.changed) return [];
      const area = typeof m.areaDesc === "string" ? m.areaDesc.slice(0, 120) : (typeof m.country === "string" ? m.country : "");
      return [finish("weather_alert", "weather_alert", state, step.version, ended, ended ? 25 : r.prominence, ended ? `${r.title} — expired / ended` : r.title, ended ? "The warning is no longer in force." : `${sev} severity, ${cert.toLowerCase()} certainty. ${area}`.trim(), { weatherSeverity: sev, weatherCertainty: cert }, step.prev && !ended ? `Severity/certainty raised (${step.prev.state} → ${state})` : null)];
    }
    case "volcano": {
      const level = String(m.alertLevel ?? r.severityLabel ?? "").toUpperCase();
      const state = ended ? "ended" : level || "activity";
      const step = await stepLedger({ kind: "global", key: r.id, alertType: "volcano_status", state, value: VOLC_RANK[level] ?? null, commit: opts.commit, force: opts.force });
      if (!step.changed) return [];
      const down = !!step.prev && ((VOLC_RANK[level] ?? 1) < (step.prev.value ?? 1) || ended);
      return [finish("volcano_status", "volcano_status", state, step.version, ended || (down && level === "NORMAL"), r.prominence, ended ? `${String(m.volcano ?? r.title)} — returned to normal` : `${String(m.volcano ?? r.title)}: alert level ${level || "activity report"}`, `${typeof m.observatory === "string" ? m.observatory : "Observatory"} ${ended ? "no longer lists the volcano above normal." : `aviation colour code ${String(m.colorCode ?? "—")}.`}`, { volcanoLevel: level || null }, step.prev ? `Alert level ${step.prev.state} → ${state}` : null)];
    }
    case "confirmed_wildfire": {
      const step = await stepLedger({ kind: "global", key: r.id, alertType: "wildfire", state: ended ? "ended" : "reported", commit: opts.commit, force: opts.force });
      if (!step.changed || ended) return [];
      return [finish("wildfire", "wildfire", "reported", step.version, false, r.prominence, r.title, `Reported wildfire incident${r.severityLabel ? ` (${r.severityLabel})` : ""}. A reported incident, not a raw satellite detection.`, {}, null)];
    }
    case "airport_status": {
      const status = ended ? "resolved" : (r.status ?? "disrupted");
      const step = await stepLedger({ kind: "global", key: r.id, alertType: "airport_status", state: status, value: AIRPORT_RANK[status] ?? 0, commit: opts.commit, force: opts.force });
      if (!step.changed) return [];
      const authority = typeof m.authority === "string" ? m.authority : r.provider;
      const words = status === "closed" ? "closed" : status === "partially_closed" ? "partially closed" : status === "resolved" ? "reopened" : "disrupted";
      return [finish("airport_status", "airport_status", status, step.version, status === "resolved", r.prominence, `${r.title} ${words}`, status === "resolved" ? `The ${authority} no longer reports a disruption at this airport.` : `Status: ${words}. Authority: ${authority}.${r.expiresAt ? ` Reported to reopen ${r.expiresAt.toISOString().slice(0, 16).replace("T", " ")} UTC.` : ""}`, { airportStatus: status }, step.prev ? `Airport status ${step.prev.state} → ${status}` : null, { icao: r.entityKey })];
    }
    case "airspace_event": {
      const type = ended ? "resolved" : (r.status ?? "restriction");
      const step = await stepLedger({ kind: "global", key: r.id, alertType: "airspace_event", state: type, commit: opts.commit, force: opts.force });
      if (!step.changed) return [];
      return [finish("airspace_event", "airspace_event", type, step.version, type === "resolved", r.prominence, ended ? `${r.title} lifted` : `${r.title}${typeof m.icaoLocation === "string" ? ` near ${m.icaoLocation}` : ""}`, (r.description ?? "").slice(0, 200), { airspaceType: type === "resolved" ? null : type }, null)];
    }
    case "chokepoint_status": {
      const status = r.status ?? "normal";
      const step = await stepLedger({ kind: "global", key: r.id, alertType: "chokepoint_status", state: status, value: CHOKE_RANK[status] ?? 0, commit: opts.commit, force: opts.force, baselineOnly: status === "normal" });
      if (!step.changed) return [];
      const dev = Number(m.deviationPct ?? 0);
      const improved = !!step.prev && (CHOKE_RANK[status] ?? 0) < (step.prev.value ?? 0);
      const resolved = status === "normal" && improved;
      return [finish("chokepoint_status", "chokepoint_status", status, step.version, resolved, r.prominence, resolved ? `${r.title} traffic returned toward normal` : `${r.title} disruption ${improved ? "eased" : "increased"}`, `Transit volume is ${Math.abs(dev)}% ${dev < 0 ? "below" : "above"} its 90-day baseline (aggregate AIS-derived counts; not a closure statement).`, { chokepointStatus: status }, step.prev ? `Transit status ${step.prev.state} → ${status}` : null)];
    }
    case "port_disruption": {
      const step = await stepLedger({ kind: "global", key: r.id, alertType: "port_disruption", state: ended ? "resolved" : "disrupted", commit: opts.commit, force: opts.force });
      if (!step.changed) return [];
      return [finish("port_disruption", "port_disruption", ended ? "resolved" : "disrupted", step.version, ended, r.prominence, ended ? `${r.title} — no longer flagged` : r.title, "Hazard-derived potential impact on ports; not a confirmed operating status.", {}, null)];
    }
    case "maritime_incident": {
      const step = await stepLedger({ kind: "global", key: r.id, alertType: "maritime_incident", state: "reported", commit: opts.commit, force: opts.force });
      if (!step.changed) return [];
      return [finish("maritime_incident", "maritime_incident", "reported", step.version, false, r.prominence, r.title, (r.description ?? "").slice(0, 200), { incidentType: String(m.incidentType ?? "") }, null)];
    }
    case "energy_disruption": {
      const mw = typeof m.capacityAffectedMw === "number" ? m.capacityAffectedMw : typeof m.capacityAffectedMwEquivalent === "number" ? m.capacityAffectedMwEquivalent : null;
      const restored = ended || r.status === "restored";
      const state = restored ? "restored" : (r.status ?? "outage");
      const step = await stepLedger({ kind: "global", key: r.id, alertType: "energy_outage", state, value: mw, commit: opts.commit, force: opts.force, material: (p) => restored || (state === "outage" && p.state === "reduced_capacity") || (mw != null && p.value != null && mw >= p.value * 1.5 && mw - p.value >= 100) });
      if (!step.changed) return [];
      return [finish("energy_outage", "energy_outage", state, step.version, restored, restored ? 30 : r.prominence, restored ? `${r.title} — restored` : r.title, restored ? "The operator no longer reports this capacity as unavailable." : `Capacity affected: ${r.severityLabel ?? "not reported"}.${r.expiresAt ? ` Expected restoration ${r.expiresAt.toISOString().slice(0, 16).replace("T", " ")} UTC.` : ""}`, { capacityMw: mw }, step.prev ? `Status ${step.prev.state} → ${state}` : null)];
    }
    case "internet_disruption": {
      const restored = ended || r.status === "restored";
      const score = r.severityValue ?? null;
      const step = await stepLedger({ kind: "global", key: r.id, alertType: "internet_outage", state: restored ? "restored" : "outage", value: score, commit: opts.commit, force: opts.force });
      if (!step.changed) return [];
      return [finish("internet_outage", "internet_outage", restored ? "restored" : "outage", step.version, restored, restored ? 30 : r.prominence, restored ? `${r.title.replace(/ — .*/, "")} — connectivity restored` : r.title, restored ? "The measurement no longer shows the anomaly." : "Observed network anomaly; the measurement does not establish the cause.", { internetScope: String(m.scope ?? ""), internetScore: score }, null)];
    }
    default:
      return [];
  }
}

/** A party's claim about a GlobalEvent's asset. Judged by the underlying event's rules; delivered only to those who enabled party claims. */
export async function deriveFromClaim(claimId: string, opts: DeriveOptions): Promise<Development[]> {
  const c = await prisma.globalEventClaim.findUnique({ where: { id: claimId }, include: { globalEvent: true } });
  if (!c?.globalEvent) return [];
  const r = c.globalEvent;
  const m = json<Record<string, unknown>>(r.metadata, {});
  const step = await stepLedger({ kind: "claim", key: c.id, alertType: "party_claim", state: "claimed", commit: opts.commit, force: opts.force });
  if (!step.changed) return [];
  const ruleType: AlertType = ({ airport_status: "airport_status", chokepoint_status: "chokepoint_status", energy_disruption: "energy_outage", internet_disruption: "internet_outage", maritime_incident: "maritime_incident", port_disruption: "port_disruption", airspace_event: "airspace_event" } as Record<string, AlertType>)[r.category] ?? "airport_status";
  const links = mapLinks(r);
  const facts: Facts = { layer: r.layer, countryCode: r.countryCode, airportStatus: "closed", chokepointStatus: "major_disruption", capacityMw: typeof m.capacityAffectedMw === "number" ? m.capacityAffectedMw : null, internetScope: "national", airspaceType: "closure", incidentType: String(m.incidentType ?? "") };
  return [
    {
      signalKind: "claim",
      signalRef: c.id,
      alertType: "party_claim",
      ruleType,
      ledgerKind: "claim",
      ledgerKey: c.id,
      state: "claimed",
      version: step.version,
      isResolution: false,
      isPartyClaim: true,
      significance: Math.min(60, r.prominence),
      confidence: 0.2,
      title: `${c.claimant} claims: ${c.text.slice(0, 120)}`,
      summary: `Unverified party claim about ${r.title}. Vigil's status for it is unchanged (${r.status ?? "no status"}).`,
      candidates: await globalCandidates(r, m),
      facts,
      deepLink: links.deepLink,
      snapshot: { kind: "party_claim", claimId: c.id, claimant: c.claimant, claimType: c.claimType, text: c.text, sourceUrl: c.sourceUrl, targetTitle: r.title, targetStatus: r.status, globalEventId: r.id, at: new Date().toISOString() },
      globalEventId: r.id,
    },
  ];
}

/** Expiry does not arrive as a provider message: a sweep raises the resolution for anything whose time has passed. */
export async function deriveExpired(opts: DeriveOptions, now: Date = new Date()): Promise<Development[]> {
  const open = await prisma.alertState.findMany({ where: { kind: "global", NOT: { state: { in: ["ended", "resolved", "restored"] } } }, select: { key: true }, take: 500 });
  if (open.length === 0) return [];
  const rows = await prisma.globalEvent.findMany({ where: { id: { in: open.map((o) => o.key) }, OR: [{ endedAt: { not: null } }, { expiresAt: { lte: now } }] }, select: { id: true } });
  const out: Development[] = [];
  for (const r of rows) out.push(...(await deriveFromGlobalEvent(r.id, opts, now)));
  return out;
}
