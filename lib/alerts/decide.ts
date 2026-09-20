import type { AlertType, Category, Priority, WatchEntityType, WatchRules, WatcherSettings } from "./types";
import { ALERT_CATEGORY } from "./types";

// Pure, explainable decisions: does a watch's rule set accept a development, and how important is the
// resulting notification for THIS watcher. No DB access here.

export interface Candidate {
  type: WatchEntityType;
  key: string;
  /** How directly the followed thing is the subject: itself 1.0, its country 0.6, its category 0.4. */
  specificity: number;
}

export interface Facts {
  conflictId?: string | null;
  conflictSlug?: string | null;
  /** Event's own severity mapped to 0-100. */
  eventSeverityScore?: number;
  eventImportance?: number;
  /** Conflict-level severity score (escalation developments). */
  conflictSeverityScore?: number;
  /** Country the event physically occurred in. */
  eventCountry?: string | null;
  /** Fighting countries of the conflict, for country relevance. */
  conflictCountries?: string[];
  magnitude?: number;
  tsunami?: boolean;
  weatherSeverity?: string | null;
  weatherCertainty?: string | null;
  volcanoLevel?: string | null;
  airportStatus?: string | null;
  airspaceType?: string | null;
  chokepointStatus?: string | null;
  incidentType?: string | null;
  capacityMw?: number | null;
  internetScope?: string | null;
  internetScore?: number | null;
  layer?: string | null;
  countryCode?: string | null;
}

export interface Development {
  signalKind: "event" | "global_event" | "territorial_change" | "conflict" | "claim";
  signalRef: string;
  /** What the notification is about (display, fingerprint). */
  alertType: AlertType;
  /** Which rules apply (a party claim about an event is judged by the event rules). */
  ruleType: AlertType;
  ledgerKind: string;
  ledgerKey: string;
  state: string;
  version: number;
  isResolution: boolean;
  isPartyClaim: boolean;
  significance: number;
  confidence: number;
  title: string;
  summary: string;
  candidates: Candidate[];
  facts: Facts;
  deepLink: string;
  /** Link to the map as it was when this was generated (historical view), when useful. */
  snapshotLink?: string | null;
  snapshot: Record<string, unknown>;
  eventId?: string | null;
  globalEventId?: string | null;
  conflictSlug?: string | null;
  /** Human descriptions of what changed, for the explanation ("revised from M5.8 to M6.4"). */
  changeNote?: string | null;
}

/** watcher + development + state + material version: one real-world development, one notification. */
export const fingerprintOf = (d: Pick<Development, "ledgerKind" | "ledgerKey" | "alertType" | "state" | "version">) => `${d.ledgerKind}:${d.ledgerKey}|${d.alertType}|${d.state}|v${d.version}`;
/** Everything about the same subject regardless of state (used for the "previously alerted" check). */
export const ledgerPrefix = (d: Pick<Development, "ledgerKind" | "ledgerKey">) => `${d.ledgerKind}:${d.ledgerKey}|`;

const SEV = ["Unknown", "Minor", "Moderate", "Severe", "Extreme"];
const CERT = ["Unknown", "Unlikely", "Possible", "Likely", "Observed"];
const VOLC = ["UNASSIGNED", "NORMAL", "ADVISORY", "WATCH", "WARNING"];
const rank = (list: string[], v: string | null | undefined) => Math.max(0, list.indexOf(v ?? ""));
export const GDACS_AS_CAP: Record<string, string> = { Green: "Minor", Orange: "Severe", Red: "Extreme" };

export interface Acceptance {
  accept: boolean;
  /** The rule that decided (accepted or not), in words. */
  rule: string;
  ruleKey: string | null;
}

export interface DecideContext {
  /** Impact score of the development's conflict for this watch's country (country watches) or the watcher's base country. */
  impactForWatchCountry: number | null;
}

/** Does this watch's effective rule set accept the development? Explains itself either way. */
export function acceptDevelopment(watch: { entityType: WatchEntityType }, r: WatchRules, dev: Development, ctx: DecideContext): Acceptance {
  const f = dev.facts;
  const yes = (rule: string, ruleKey: string): Acceptance => ({ accept: true, rule, ruleKey });
  const no = (rule: string): Acceptance => ({ accept: false, rule, ruleKey: null });
  const country = watch.entityType === "country";
  const impact = ctx.impactForWatchCountry ?? 0;

  if (dev.isResolution) {
    const k = r.restoration === true || r.anyChange === true;
    return k ? yes("Restoration / resolution alerts are on", r.restoration === true ? "restoration" : "anyChange") : no("Restoration alerts are off for this watch");
  }

  switch (dev.ruleType) {
    case "conflict_event": {
      const imp = f.eventImportance ?? 0;
      if (country) {
        const min = num(r.minEventImportance);
        if (min === null) return no("No event-importance rule set");
        const relevant = impact >= (num(r.minImpact) ?? 0);
        if (!relevant) return no(`Conflict impact for this country (${impact}) is below ${num(r.minImpact) ?? 0}`);
        return imp >= min ? yes(`Event importance ${imp} ≥ ${min} and conflict impact ${impact} ≥ ${num(r.minImpact) ?? 0}`, "minEventImportance") : no(`Event importance ${imp} is below ${min}`);
      }
      const minImp = num(r.minEventImportance);
      if (minImp !== null && imp >= minImp) return yes(`Event importance ${imp} ≥ ${minImp}`, "minEventImportance");
      const minSev = num(r.minSeverity);
      if (minSev !== null && (f.eventSeverityScore ?? 0) >= minSev) return yes(`Event severity ${f.eventSeverityScore} ≥ ${minSev}`, "minSeverity");
      return no("Below the importance / severity thresholds");
    }
    case "conflict_escalation": {
      if (!r.escalation) return no("Escalation alerts are off");
      if (country && impact < (num(r.minImpact) ?? 0)) return no(`Conflict impact for this country (${impact}) is below ${num(r.minImpact) ?? 0}`);
      const minSev = num(r.minSeverity);
      if (minSev !== null && (f.conflictSeverityScore ?? 0) < minSev) return no(`Conflict severity ${f.conflictSeverityScore} is below ${minSev}`);
      return yes(country ? `Major escalation; conflict impact ${impact}` : "Major escalation detected", "escalation");
    }
    case "conflict_status":
      return r.statusChange ? yes("Conflict status change alerts are on", "statusChange") : no("Status change alerts are off");
    case "new_actor":
      return r.newActor ? yes("New actor involvement alerts are on", "newActor") : no("New actor alerts are off");
    case "territorial_change": {
      if (!r.territorialChange) return no("Territorial change alerts are off");
      if (country && impact < (num(r.minImpact) ?? 0)) return no(`Conflict impact for this country (${impact}) is below ${num(r.minImpact) ?? 0}`);
      return yes("Approved territorial change", "territorialChange");
    }
    case "conflicting_claims":
      return r.conflictingClaims ? yes("Conflicting territorial claims alerts are on", "conflictingClaims") : no("Conflicting-claims alerts are off");
    case "earthquake": {
      const min = num(r.minMagnitude);
      if (min !== null && (f.magnitude ?? 0) >= min) return yes(`Magnitude ${f.magnitude?.toFixed(1)} ≥ ${min}`, "minMagnitude");
      if (r.tsunami && f.tsunami) return yes("Tsunami flag set by the provider", "tsunami");
      return no(`Magnitude ${f.magnitude?.toFixed(1)} is below ${min ?? "the threshold"}`);
    }
    case "weather_alert": {
      const minSev = str(r.weatherMinSeverity);
      if (!minSev) return no("No weather severity rule set");
      if (rank(SEV, f.weatherSeverity) < rank(SEV, minSev)) return no(`Severity ${f.weatherSeverity} is below ${minSev}`);
      const minCert = str(r.weatherMinCertainty);
      if (minCert && rank(CERT, f.weatherCertainty) < rank(CERT, minCert)) return no(`Certainty ${f.weatherCertainty} is below ${minCert}`);
      return yes(`Severity ${f.weatherSeverity} ≥ ${minSev}${minCert ? `, certainty ${f.weatherCertainty} ≥ ${minCert}` : ""}`, "weatherMinSeverity");
    }
    case "volcano_status": {
      const min = str(r.volcanoMinLevel);
      if (!min) return no("No volcano level rule set");
      return rank(VOLC, f.volcanoLevel) >= rank(VOLC, min) ? yes(`Alert level ${f.volcanoLevel ?? "activity"} ≥ ${min}`, "volcanoMinLevel") : no(`Alert level ${f.volcanoLevel ?? "activity"} is below ${min}`);
    }
    case "wildfire":
      return r.anyChange ? yes("Any change in this category", "anyChange") : no("Wildfire alerts are off");
    case "airport_status": {
      if (f.airportStatus === "closed") return r.airportClosed ? yes("Airport closed", "airportClosed") : no("Airport closure alerts are off");
      if (f.airportStatus === "partially_closed" || f.airportStatus === "disrupted") return r.airportDisruption ? yes(`Airport ${String(f.airportStatus).replace("_", " ")}`, "airportDisruption") : no("Disruption alerts are off (closures only)");
      return no("Not a closure or major disruption");
    }
    case "airspace_event":
      return r.airspace && (f.airspaceType === "closure" || f.airspaceType === "restriction") ? yes(`Airspace ${f.airspaceType}`, "airspace") : no("Airspace alerts are off or not a closure/restriction");
    case "chokepoint_status": {
      if (f.chokepointStatus === "major_disruption" || f.chokepointStatus === "closed_restricted") return r.chokepointMajor ? yes("Major transit disruption threshold reached", "chokepointMajor") : no("Major disruption alerts are off");
      if (f.chokepointStatus === "elevated_disruption") return r.chokepointElevated ? yes("Elevated disruption alerts are on", "chokepointElevated") : no("Only major disruption is alerted for this watch");
      return no("Not a disruption");
    }
    case "port_disruption":
      return r.portDisruption ? yes("Port disruption alerts are on", "portDisruption") : no("Port alerts are off");
    case "maritime_incident":
      return r.securityIncident ? yes(`Maritime security incident (${f.incidentType ?? "notice"})`, "securityIncident") : no("Security incident alerts are off");
    case "energy_outage": {
      const min = num(r.minCapacityMw);
      if (min !== null && f.capacityMw != null && f.capacityMw >= min) return yes(`Capacity affected ${Math.round(f.capacityMw)} MW ≥ ${min} MW`, "minCapacityMw");
      if (r.anyChange) return yes("Any status change", "anyChange");
      return no(min !== null && f.capacityMw == null ? "Capacity not reported (never guessed)" : `Capacity ${f.capacityMw ?? "?"} MW is below ${min ?? "the threshold"} MW`);
    }
    case "internet_outage": {
      if (r.internetNational && f.internetScope === "national") return yes("National internet outage", "internetNational");
      const min = num(r.minInternetScore);
      if (min !== null && (f.internetScore ?? 0) >= min) return yes(`Anomaly score ${f.internetScore} ≥ ${min}`, "minInternetScore");
      if (r.anyChange) return yes("Any status change", "anyChange");
      return no("Below the internet outage thresholds");
    }
    default:
      return no("No rule for this alert type");
  }
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

// ---------------------------------------------------------------------------------------------
// Priority (LOW / MEDIUM / HIGH / CRITICAL) — not severity. A far-away M7 is globally significant but
// only MEDIUM for someone who follows the country; a closure at an airport you explicitly follow is
// HIGH; war inside your own country is CRITICAL. Volume never counts: the inputs are the
// development's own significance, the user's impact, how directly they follow the subject, and how well
// it is confirmed (independent groups, capped) — never how many reports there are.
// ---------------------------------------------------------------------------------------------
export interface PriorityInput {
  significance: number;
  /** 0-100: conflict impact for the watcher's country, or 100 when a hazard/infrastructure event is in it. */
  userImpact: number;
  specificity: number;
  confidence: number;
  ownCountryWar?: boolean;
  isResolution: boolean;
  isPartyClaim: boolean;
}
export interface PriorityResult {
  priority: Priority;
  score: number;
  factors: { name: string; value: number; weight: number }[];
  notes: string[];
}

export function computePriority(i: PriorityInput): PriorityResult {
  const factors = [
    { name: "Development significance", value: Math.round(i.significance), weight: 0.45 },
    { name: "Impact on you", value: Math.round(i.userImpact), weight: 0.25 },
    { name: "How directly you follow it", value: Math.round(i.specificity * 100), weight: 0.2 },
    { name: "Confirmation", value: Math.round(i.confidence * 100), weight: 0.1 },
  ];
  const score = Math.round(factors.reduce((a, f) => a + f.value * f.weight, 0));
  const notes: string[] = [];
  let level: Priority = score >= 85 ? "CRITICAL" : score >= 60 ? "HIGH" : score >= 40 ? "MEDIUM" : "LOW";
  if (i.ownCountryWar) {
    level = "CRITICAL";
    notes.push("Active war inside your selected country");
  }
  const cap = (max: Priority, why: string) => {
    const order: Priority[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
    if (order.indexOf(level) > order.indexOf(max)) {
      level = max;
      notes.push(why);
    }
  };
  if (i.isPartyClaim) cap("MEDIUM", "Unverified party claim: capped at MEDIUM");
  if (i.isResolution) cap("MEDIUM", "Resolution / restoration: capped at MEDIUM");
  return { priority: level, score, factors, notes };
}

export const categoryOf = (t: AlertType): Category => ALERT_CATEGORY[t];
export type { WatcherSettings };
