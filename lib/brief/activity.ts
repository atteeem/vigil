import { confidenceLabel } from "./scoring";
import type { EscalationAssessment, EscalationSignal, HotspotAssessment, Trend } from "./types";

// ONE deterministic, explainable model of conflict activity, used for both the escalation /
// de-escalation trend and the emerging-hotspot detector. Pure functions over CANONICAL events (one row
// per real incident): reporting volume can never enter, because a sourced incident is one row however
// many outlets report it. Source information is used only to judge how well an incident is supported.

export const HOUR = 3_600_000;
export const BASELINE_MS = 7 * 24 * HOUR;
const SEV_ORDER = ["stable", "guarded", "elevated", "high", "severe", "extreme"];
const SEV_SCORE: Record<string, number> = { stable: 15, guarded: 35, elevated: 55, high: 72, severe: 82, extreme: 92 };
export const sevRank = (s: string) => Math.max(0, SEV_ORDER.indexOf(s));
export const sevScore = (s: string) => SEV_SCORE[s] ?? 35;
const SEVERE_RANK = 3; // high and above

export interface ActivityEvent {
  id: string;
  at: number;
  severity: string;
  importance: number;
  /** null for country-level / unknown-location events: they count as activity but occupy no map cell. */
  lat: number | null;
  lng: number | null;
  killed: number | null;
  /** Independent source groups (never a raw report count). */
  independent: number;
  infrastructure: boolean;
}

export interface ConflictTransition {
  kind: "status" | "severity" | "actor";
  at: number;
  from: string | null;
  to: string;
}

const cell = (lat: number, lng: number) => `${Math.floor(lat * 2)}:${Math.floor(lng * 2)}`; // ~0.5 degree grid
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const r1 = (n: number) => Math.round(n * 10) / 10;

const STATUS_RANK: Record<string, number> = { active: 3, reduced: 2, dormant: 1, ended: 0, resolved: 0, archived: 0 };

export interface EscalationInput {
  conflictSlug: string;
  conflictName: string;
  from: number;
  to: number;
  /** Canonical events in [from - baseline, to]. */
  events: ActivityEvent[];
  transitions: ConflictTransition[];
  /** Times of approved territorial changes in [from - baseline, to]. */
  territorialChanges: number[];
}

export function assessEscalation(i: EscalationInput): EscalationAssessment {
  const H = Math.max(1, (i.to - i.from) / HOUR);
  const win = i.events.filter((e) => e.at >= i.from && e.at <= i.to);
  const base = i.events.filter((e) => e.at < i.from && e.at >= i.from - BASELINE_MS);
  const baseHours = BASELINE_MS / HOUR;
  const severeWin = win.filter((e) => sevRank(e.severity) >= SEVERE_RANK);
  const severeBase = base.filter((e) => sevRank(e.severity) >= SEVERE_RANK);
  const expectedSevere = (severeBase.length / baseHours) * H;
  const signals: EscalationSignal[] = [];
  const add = (name: string, delta: number, detail: string) => delta !== 0 && signals.push({ name, delta: Math.round(delta), detail });
  const sustained = H >= 12; // a drop over a very short window is not a sustained reduction

  // 1. Frequency of severe incidents (canonical events) against the conflict's own baseline.
  if (severeWin.length >= 2 && severeWin.length >= expectedSevere * 2 + 1) add("severe_events_up", Math.min(30, 10 * (severeWin.length - expectedSevere)), `${severeWin.length} high-severity incidents vs ~${r1(expectedSevere)} expected from the previous 7 days`);
  else if (sustained && expectedSevere >= 3 && severeWin.length <= expectedSevere * 0.25) add("severe_events_down", -Math.min(30, 8 * (expectedSevere - severeWin.length)), `${severeWin.length} high-severity incidents vs ~${r1(expectedSevere)} expected from the previous 7 days`);

  // 2. Mean incident severity.
  const mw = mean(win.map((e) => sevScore(e.severity)));
  const mb = mean(base.map((e) => sevScore(e.severity)));
  if (mw != null && mb != null && win.length >= 2 && base.length >= 3) {
    const d = mw - mb;
    if (d >= 12) add("severity_up", Math.min(20, d / 2), `average incident severity ${Math.round(mb)} → ${Math.round(mw)}`);
    else if (d <= -12 && sustained) add("severity_down", -Math.min(15, Math.abs(d) / 2), `average incident severity ${Math.round(mb)} → ${Math.round(mw)}`);
  }

  // 3. Geographic spread: fighting in places with no incident in the baseline.
  const baseCells = new Set(base.flatMap((e) => (e.lat == null || e.lng == null ? [] : [cell(e.lat, e.lng)])));
  const newCells = new Set(win.flatMap((e) => (e.lat == null || e.lng == null ? [] : [cell(e.lat, e.lng)])).filter((c) => !baseCells.has(c)));
  if (base.length >= 3 && newCells.size > 0) add("new_geography", Math.min(15, 7 * newCells.size), `incidents in ${newCells.size} area${newCells.size === 1 ? "" : "s"} with none in the previous 7 days`);

  // 4. High-importance incidents.
  const important = win.filter((e) => e.importance >= 80);
  if (important.length > 0) add("high_importance_events", Math.min(15, 6 * important.length), `${important.length} high-importance incident${important.length === 1 ? "" : "s"}`);

  // 5. Casualties, counted only from incidents with two independent source groups.
  const killedWin = win.filter((e) => e.independent >= 2).reduce((s, e) => s + (e.killed ?? 0), 0);
  const killedBaseRate = base.filter((e) => e.independent >= 2).reduce((s, e) => s + (e.killed ?? 0), 0) / baseHours;
  const expectedKilled = killedBaseRate * H;
  if (killedWin >= 10 && killedWin >= 2 * expectedKilled + 10) add("corroborated_casualties", Math.min(20, killedWin / 5), `${killedWin} deaths in corroborated incidents (about ${Math.round(expectedKilled)} expected)`);

  // 6. Infrastructure disruption.
  const infra = win.filter((e) => e.infrastructure);
  if (infra.length > 0) add("infrastructure_disruption", Math.min(10, 5 * infra.length), `${infra.length} infrastructure incident${infra.length === 1 ? "" : "s"}`);

  // 7. Territorial change (approved only).
  const tWin = i.territorialChanges.filter((t) => t >= i.from && t <= i.to).length;
  const tBase = i.territorialChanges.filter((t) => t < i.from && t >= i.from - BASELINE_MS).length;
  if (tWin > 0) add("territorial_changes", Math.min(20, 10 * tWin), `${tWin} approved territorial change${tWin === 1 ? "" : "s"}`);
  else if (H >= 24 && tBase >= 2) add("territorial_changes_ceased", -8, `no approved territorial changes, after ${tBase} in the previous 7 days`);

  // 8. Structural transitions recorded in the state ledger.
  for (const t of i.transitions) {
    if (t.at < i.from || t.at > i.to) continue;
    if (t.kind === "actor") add("new_actor", 12, "a new actor is recorded as involved");
    else if (t.kind === "status") {
      const a = STATUS_RANK[t.from ?? ""] ?? 2;
      const b = STATUS_RANK[t.to] ?? 2;
      if (b > a) add("status_up", 30, `status ${t.from ?? "?"} → ${t.to}`);
      else if (b < a) add("status_down", -35, `status ${t.from ?? "?"} → ${t.to}`);
    } else if (t.kind === "severity") {
      const a = sevRank(t.from ?? "");
      const b = sevRank(t.to);
      if (b > a) add("severity_band_up", 15, `severity band ${t.from ?? "?"} → ${t.to}`);
      else if (b < a) add("severity_band_down", -15, `severity band ${t.from ?? "?"} → ${t.to}`);
    }
  }

  const score = clamp(signals.reduce((s, x) => s + x.delta, 0), -100, 100);
  const structural = signals.some((s) => ["status_up", "status_down", "new_actor", "severity_band_up", "severity_band_down", "territorial_changes"].includes(s.name));
  const thin = win.length + base.length < 3 && !structural;
  const trend: Trend = thin ? "uncertain" : score >= 20 ? "escalating" : score <= -20 ? "de-escalating" : "stable";
  const volume = Math.min(1, (win.length + base.length) / 12);
  const quality = win.length ? win.filter((e) => e.independent >= 1).length / win.length : base.length ? base.filter((e) => e.independent >= 1).length / base.length : 0;
  const confidence = clamp(0.2 + 0.35 * volume + 0.3 * quality + (structural ? 0.1 : 0), 0.05, 0.95);
  const ordered = [...signals].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || a.name.localeCompare(b.name));
  return {
    conflictSlug: i.conflictSlug,
    conflictName: i.conflictName,
    trend,
    score,
    confidence: Math.round(confidence * 100) / 100,
    confidenceLabel: confidenceLabel(confidence),
    signals: ordered,
    reasons: thin ? ["Too little recorded activity in this period and the previous 7 days to assess a trend."] : ordered.length ? ordered.map((s) => s.detail) : ["No material change in incident severity, frequency or geography against the previous 7 days."],
    metrics: { windowEvents: win.length, baselineEvents: base.length, windowSevere: severeWin.length, baselineSevereRate: Math.round((severeBase.length / baseHours) * 1000) / 1000, newCells: newCells.size, windowHours: Math.round(H * 10) / 10 },
  };
}

export interface HotspotInput {
  key: string;
  label: string;
  conflictSlug: string | null;
  countryCode: string | null;
  from: number;
  to: number;
  events: ActivityEvent[];
  /** Approved/uncertain territorial claims dated inside the window. */
  territorialClaims: number;
  newActors: number;
}

export const HOTSPOT_MIN_SCORE = 30;

export function assessHotspot(i: HotspotInput): HotspotAssessment | null {
  const H = Math.max(1, (i.to - i.from) / HOUR);
  const win = i.events.filter((e) => e.at >= i.from && e.at <= i.to);
  const base = i.events.filter((e) => e.at < i.from && e.at >= i.from - BASELINE_MS);
  const baseHours = BASELINE_MS / HOUR;
  const expected = (base.length / baseHours) * H;
  const reasons: string[] = [];
  let score = 0;

  // Frequency against the area's OWN baseline: a permanently busy front (rate ~ baseline) scores ~0.
  let freq = 0;
  if (win.length >= 2) {
    const z = (win.length - expected) / Math.sqrt(expected + 1);
    freq = clamp(z * 12, 0, 40);
    if (freq >= 8) reasons.push(`+ event frequency: ${win.length} incidents vs ~${r1(expected)} expected from the previous 7 days`);
  }
  score += freq;

  const mw = mean(win.map((e) => sevScore(e.severity)));
  const mb = base.length >= 2 ? mean(base.map((e) => sevScore(e.severity))) : 30; // no history: compared with a low default
  let sev = 0;
  if (mw != null && win.length >= 2 && mb != null) {
    sev = clamp((mw - mb) * 0.8, 0, 20);
    if (sev >= 5) reasons.push(`+ severity: average incident severity ${Math.round(mb)} → ${Math.round(mw)}`);
  }
  score += sev;

  const baseCells = new Set(base.flatMap((e) => (e.lat == null || e.lng == null ? [] : [cell(e.lat, e.lng)])));
  const newCells = new Set(win.flatMap((e) => (e.lat == null || e.lng == null ? [] : [cell(e.lat, e.lng)])).filter((c) => !baseCells.has(c)));
  const spread = win.length >= 2 ? clamp(8 * newCells.size, 0, 20) : 0;
  if (spread > 0) reasons.push(`+ geographic spread: ${newCells.size} new area${newCells.size === 1 ? "" : "s"} with incidents`);
  score += spread;

  const terr = clamp(8 * i.territorialClaims, 0, 15);
  if (terr > 0) reasons.push(`+ territorial claims: ${i.territorialClaims} reviewed claim${i.territorialClaims === 1 ? "" : "s"} in this period`);
  score += terr;

  const infra = win.filter((e) => e.infrastructure).length;
  const infraScore = clamp(5 * infra, 0, 10);
  if (infraScore > 0) reasons.push(`+ infrastructure disruption: ${infra} incident${infra === 1 ? "" : "s"}`);
  score += infraScore;

  if (i.newActors > 0) {
    score += 10;
    reasons.push("+ new actor involvement");
  }

  if (win.length < 2 && i.territorialClaims === 0 && i.newActors === 0) return null; // one incident is not a pattern
  const total = Math.round(clamp(score, 0, 100));
  if (total < HOTSPOT_MIN_SCORE) return null;

  const supported = win.length ? win.filter((e) => e.independent >= 1).length / win.length : 0;
  const confidence = clamp(0.2 + 0.4 * Math.min(1, win.length / 5) + 0.35 * supported, 0.05, 0.95);
  const label2 = total >= 60 && (sev > 0 || spread > 0) ? "Rapid escalation" : sev >= 5 || freq >= 20 ? "Increased conflict activity" : "Emerging activity";
  const lat = mean(win.flatMap((e) => (e.lat == null ? [] : [e.lat])));
  const lng = mean(win.flatMap((e) => (e.lng == null ? [] : [e.lng])));
  return {
    key: i.key,
    label: i.label,
    conflictSlug: i.conflictSlug,
    countryCode: i.countryCode,
    score: total,
    label2,
    confidence: Math.round(confidence * 100) / 100,
    confidenceLabel: confidenceLabel(confidence),
    reasons,
    metrics: { windowEvents: win.length, expectedEvents: r1(expected), baselineEvents: base.length, windowMeanSeverity: mw == null ? null : Math.round(mw), baselineMeanSeverity: mb == null ? null : Math.round(mb), newCells: newCells.size, territorialClaims: i.territorialClaims, infrastructureEvents: infra, newActors: i.newActors },
    deepLink: i.conflictSlug ? `/conflict/${i.conflictSlug}` : i.countryCode ? `/brief/country/${i.countryCode}` : "/world",
    lat: lat == null ? null : Math.round(lat * 1000) / 1000,
    lng: lng == null ? null : Math.round(lng * 1000) / 1000,
  };
}
