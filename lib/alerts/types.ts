// Watchlists, notifications and alert rules: shared vocabulary.
//
// A WATCH follows one thing (entityType + entityKey). A DEVELOPMENT is a meaningful state change derived
// from the existing systems (a published/updated conflict event, an approved territorial change, a
// GlobalEvent status change). The engine matches developments to watches through their candidate keys,
// applies the watch's rules, and creates at most one NOTIFICATION per watcher per fingerprint.

export const WATCH_ENTITY_TYPES = ["country", "conflict", "actor", "unit", "airport", "port", "chokepoint", "volcano", "watchkey", "layer"] as const;
export type WatchEntityType = (typeof WATCH_ENTITY_TYPES)[number];

export const ENTITY_TYPE_LABEL: Record<WatchEntityType, string> = {
  country: "Country",
  conflict: "Conflict",
  actor: "Actor",
  unit: "Military unit",
  airport: "Airport",
  port: "Port",
  chokepoint: "Chokepoint",
  volcano: "Volcano",
  watchkey: "Infrastructure / place",
  layer: "Event category",
};

export const WATCH_MODES = ["major", "important", "custom"] as const;
export type WatchMode = (typeof WATCH_MODES)[number];
export const MODE_LABEL: Record<WatchMode, string> = { major: "Major developments only", important: "All important", custom: "Custom" };

export const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export type Priority = (typeof PRIORITIES)[number];
export const priorityRank = (p: Priority | string) => PRIORITIES.indexOf(p as Priority);

/** User-facing notification categories (settings toggles). */
export const CATEGORIES = ["conflicts", "territorial", "hazards", "aviation", "maritime", "energy", "internet"] as const;
export type Category = (typeof CATEGORIES)[number];
export const CATEGORY_LABEL: Record<Category, string> = { conflicts: "Conflicts", territorial: "Territorial changes", hazards: "Natural hazards", aviation: "Aviation", maritime: "Maritime", energy: "Energy", internet: "Internet" };

export const ALERT_TYPES = [
  "conflict_event",
  "conflict_escalation",
  "conflict_status",
  "new_actor",
  "territorial_change",
  "conflicting_claims",
  "earthquake",
  "weather_alert",
  "volcano_status",
  "wildfire",
  "airport_status",
  "airspace_event",
  "chokepoint_status",
  "port_disruption",
  "maritime_incident",
  "energy_outage",
  "internet_outage",
  "party_claim",
] as const;
export type AlertType = (typeof ALERT_TYPES)[number];

export const ALERT_CATEGORY: Record<AlertType, Category> = {
  conflict_event: "conflicts",
  conflict_escalation: "conflicts",
  conflict_status: "conflicts",
  new_actor: "conflicts",
  territorial_change: "territorial",
  conflicting_claims: "territorial",
  earthquake: "hazards",
  weather_alert: "hazards",
  volcano_status: "hazards",
  wildfire: "hazards",
  airport_status: "aviation",
  airspace_event: "aviation",
  chokepoint_status: "maritime",
  port_disruption: "maritime",
  maritime_incident: "maritime",
  energy_outage: "energy",
  internet_outage: "internet",
  party_claim: "conflicts",
};

// ---------------------------------------------------------------------------------------------
// Rules. Not every rule applies to every entity: RULE_SCHEMA lists what each entity type may set, with
// the value each mode implies. "custom" uses exactly what the user set (unset = off).
// ---------------------------------------------------------------------------------------------
export type RuleValue = boolean | number | string | null;
export type WatchRules = Record<string, RuleValue>;

export interface RuleDef {
  key: string;
  label: string;
  kind: "boolean" | "number" | "enum";
  options?: string[];
  min?: number;
  max?: number;
  unit?: string;
  major: RuleValue;
  important: RuleValue;
}

const R = {
  minSeverity: { key: "minSeverity", label: "Conflict severity at least", kind: "number", min: 0, max: 100, unit: "/100", major: 70, important: 45 },
  minImpact: { key: "minImpact", label: "Impact on you / this country at least", kind: "number", min: 0, max: 100, unit: "/100", major: 75, important: 50 },
  escalation: { key: "escalation", label: "Major escalation", kind: "boolean", major: true, important: true },
  minEventImportance: { key: "minEventImportance", label: "New event with importance at least", kind: "number", min: 0, max: 100, major: 80, important: 60 },
  territorialChange: { key: "territorialChange", label: "Approved territorial change", kind: "boolean", major: true, important: true },
  conflictingClaims: { key: "conflictingClaims", label: "Conflicting territorial claims", kind: "boolean", major: false, important: true },
  newActor: { key: "newActor", label: "New actor involvement", kind: "boolean", major: false, important: true },
  statusChange: { key: "statusChange", label: "Conflict status change", kind: "boolean", major: true, important: true },
  minMagnitude: { key: "minMagnitude", label: "Earthquake magnitude at least", kind: "number", min: 3, max: 9.5, major: 6.5, important: 5.5 },
  tsunami: { key: "tsunami", label: "Tsunami flag", kind: "boolean", major: true, important: true },
  weatherMinSeverity: { key: "weatherMinSeverity", label: "Weather alert severity at least", kind: "enum", options: ["Moderate", "Severe", "Extreme"], major: "Extreme", important: "Severe" },
  weatherMinCertainty: { key: "weatherMinCertainty", label: "Weather certainty at least", kind: "enum", options: ["Possible", "Likely", "Observed"], major: "Likely", important: "Possible" },
  volcanoMinLevel: { key: "volcanoMinLevel", label: "Volcano alert level at least", kind: "enum", options: ["ADVISORY", "WATCH", "WARNING"], major: "WATCH", important: "ADVISORY" },
  airportClosed: { key: "airportClosed", label: "Airport closed", kind: "boolean", major: true, important: true },
  airportDisruption: { key: "airportDisruption", label: "Major disruption / partial closure", kind: "boolean", major: false, important: true },
  airspace: { key: "airspace", label: "Airspace closure / restriction", kind: "boolean", major: true, important: true },
  chokepointMajor: { key: "chokepointMajor", label: "Major transit disruption", kind: "boolean", major: true, important: true },
  chokepointElevated: { key: "chokepointElevated", label: "Elevated disruption", kind: "boolean", major: false, important: true },
  portDisruption: { key: "portDisruption", label: "Port disruption", kind: "boolean", major: true, important: true },
  securityIncident: { key: "securityIncident", label: "Maritime security incident", kind: "boolean", major: true, important: true },
  minCapacityMw: { key: "minCapacityMw", label: "Outage capacity at least", kind: "number", min: 0, max: 100000, unit: "MW", major: 1000, important: 300 },
  internetNational: { key: "internetNational", label: "National internet outage", kind: "boolean", major: true, important: true },
  minInternetScore: { key: "minInternetScore", label: "Internet anomaly score at least", kind: "number", min: 0, max: 100000, major: 1000, important: 300 },
  restoration: { key: "restoration", label: "Tell me when it is restored / resolved", kind: "boolean", major: true, important: true },
  anyChange: { key: "anyChange", label: "Any status change", kind: "boolean", major: true, important: true },
  // Custom watches only: explicitly include unverified party / aligned claims for this watch.
  includePartyClaims: { key: "includePartyClaims", label: "Include unverified party claims", kind: "boolean", major: false, important: false },
} satisfies Record<string, RuleDef>;

const LAYER_RULES: Record<string, RuleDef[]> = {
  earthquakes: [R.minMagnitude, R.tsunami],
  weather: [R.weatherMinSeverity, R.weatherMinCertainty, R.restoration],
  volcanoes: [R.volcanoMinLevel, R.restoration],
  fires: [R.anyChange],
  aviation: [R.airportClosed, R.airportDisruption, R.airspace, R.restoration],
  maritime: [R.chokepointMajor, R.chokepointElevated, R.portDisruption, R.securityIncident, R.restoration],
  energy: [R.minCapacityMw, R.restoration],
  internet: [R.internetNational, R.minInternetScore, R.restoration],
};

export function ruleSchemaFor(entityType: WatchEntityType, entityKey = ""): RuleDef[] {
  const base = baseRuleSchema(entityType, entityKey);
  return entityType === "port" || entityType === "volcano" ? base : [...base, R.includePartyClaims];
}

function baseRuleSchema(entityType: WatchEntityType, entityKey: string): RuleDef[] {
  switch (entityType) {
    case "conflict":
      return [R.minSeverity, R.minImpact, R.escalation, R.minEventImportance, R.territorialChange, R.conflictingClaims, R.newActor, R.statusChange];
    case "country":
      return [R.minImpact, R.minEventImportance, R.escalation, R.territorialChange, R.minMagnitude, R.tsunami, R.weatherMinSeverity, R.volcanoMinLevel, R.airportClosed, R.minCapacityMw, R.internetNational, R.restoration];
    case "actor":
    case "unit":
      return [R.minEventImportance, R.territorialChange, R.conflictingClaims];
    case "airport":
      return [R.airportClosed, R.airportDisruption, R.airspace, R.restoration];
    case "port":
      return [R.portDisruption, R.restoration];
    case "chokepoint":
      return [R.chokepointMajor, R.chokepointElevated, R.restoration];
    case "volcano":
      return [R.volcanoMinLevel, R.restoration];
    case "watchkey":
      return [R.minCapacityMw, R.minInternetScore, R.internetNational, R.anyChange, R.restoration];
    case "layer":
      return LAYER_RULES[entityKey] ?? [R.anyChange];
  }
}

/** The effective rule set for a watch: mode defaults, or exactly the user's custom choices. */
export function effectiveRules(entityType: WatchEntityType, entityKey: string, mode: WatchMode, custom: WatchRules): WatchRules {
  const out: WatchRules = {};
  for (const def of ruleSchemaFor(entityType, entityKey)) {
    if (mode === "major") out[def.key] = def.major;
    else if (mode === "important") out[def.key] = def.important;
    else out[def.key] = custom[def.key] ?? (def.kind === "boolean" ? false : null);
  }
  return out;
}

/** Validates user-supplied rules against the entity's schema: unknown keys are rejected, values coerced. */
export function validateRules(entityType: WatchEntityType, entityKey: string, input: unknown): { ok: true; rules: WatchRules } | { ok: false; error: string } {
  if (input == null) return { ok: true, rules: {} };
  if (typeof input !== "object" || Array.isArray(input)) return { ok: false, error: "rules must be an object" };
  const defs = new Map(ruleSchemaFor(entityType, entityKey).map((d) => [d.key, d]));
  const rules: WatchRules = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    const def = defs.get(k);
    if (!def) return { ok: false, error: `Rule "${k}" does not apply to a ${entityType} watch` };
    if (v === null) {
      rules[k] = null;
      continue;
    }
    if (def.kind === "boolean") {
      if (typeof v !== "boolean") return { ok: false, error: `Rule "${k}" must be true or false` };
      rules[k] = v;
    } else if (def.kind === "number") {
      const n = Number(v);
      if (!Number.isFinite(n) || (def.min != null && n < def.min) || (def.max != null && n > def.max)) return { ok: false, error: `Rule "${k}" must be a number between ${def.min} and ${def.max}` };
      rules[k] = n;
    } else {
      if (typeof v !== "string" || !def.options!.includes(v)) return { ok: false, error: `Rule "${k}" must be one of ${def.options!.join(", ")}` };
      rules[k] = v;
    }
  }
  return { ok: true, rules };
}

// ---------------------------------------------------------------------------------------------
// Watcher settings
// ---------------------------------------------------------------------------------------------
export interface WatcherSettings {
  enabled: boolean;
  /** Deliver "X claims ..." notifications (party / aligned sources). Default OFF; mirrors the app-wide party-claims setting. */
  partyClaims: boolean;
  /** Also tell me when a situation improves (reopened, restored, expired). */
  resolutionAlerts: boolean;
  minPriority: Priority;
  categories: Record<Category, boolean>;
  /** Foundation only: notifications generated in quiet hours are flagged `quiet` (no external delivery exists yet). */
  quietHours: { enabled: boolean; start: string; end: string; timezone: string };
  /** The country the user selected in the app (impact / relevance); never inferred. */
  baseCountry: string | null;
}

export const DEFAULT_SETTINGS: WatcherSettings = {
  enabled: true,
  partyClaims: false,
  resolutionAlerts: true,
  minPriority: "LOW",
  categories: { conflicts: true, territorial: true, hazards: true, aviation: true, maritime: true, energy: true, internet: true },
  quietHours: { enabled: false, start: "22:00", end: "07:00", timezone: "UTC" },
  baseCountry: null,
};

export function parseSettings(json: string | null | undefined): WatcherSettings {
  let raw: Partial<WatcherSettings> = {};
  try {
    raw = JSON.parse(json ?? "{}") as Partial<WatcherSettings>;
  } catch {
    /* defaults */
  }
  return { ...DEFAULT_SETTINGS, ...raw, categories: { ...DEFAULT_SETTINGS.categories, ...(raw.categories ?? {}) }, quietHours: { ...DEFAULT_SETTINGS.quietHours, ...(raw.quietHours ?? {}) } };
}

export function validateSettingsPatch(input: unknown): { ok: true; patch: Partial<WatcherSettings> } | { ok: false; error: string } {
  if (!input || typeof input !== "object") return { ok: false, error: "settings must be an object" };
  const i = input as Record<string, unknown>;
  const patch: Partial<WatcherSettings> = {};
  for (const k of ["enabled", "partyClaims", "resolutionAlerts"] as const) {
    if (k in i) {
      if (typeof i[k] !== "boolean") return { ok: false, error: `${k} must be true or false` };
      patch[k] = i[k] as boolean;
    }
  }
  if ("minPriority" in i) {
    if (!PRIORITIES.includes(i.minPriority as Priority)) return { ok: false, error: "minPriority must be LOW, MEDIUM, HIGH or CRITICAL" };
    patch.minPriority = i.minPriority as Priority;
  }
  if ("categories" in i) {
    const cats = i.categories as Record<string, unknown>;
    const out = {} as Record<Category, boolean>;
    for (const [k, v] of Object.entries(cats ?? {})) {
      if (!CATEGORIES.includes(k as Category) || typeof v !== "boolean") return { ok: false, error: `Unknown category or value: ${k}` };
      out[k as Category] = v;
    }
    patch.categories = out as WatcherSettings["categories"];
  }
  if ("quietHours" in i) {
    const q = i.quietHours as Record<string, unknown>;
    const time = /^\d{2}:\d{2}$/;
    if (typeof q?.enabled !== "boolean" || !time.test(String(q.start)) || !time.test(String(q.end))) return { ok: false, error: "quietHours needs enabled, start and end (HH:MM)" };
    patch.quietHours = { enabled: q.enabled, start: String(q.start), end: String(q.end), timezone: typeof q.timezone === "string" ? q.timezone : "UTC" };
  }
  if ("baseCountry" in i) patch.baseCountry = typeof i.baseCountry === "string" && /^[A-Za-z]{2}$/.test(i.baseCountry) ? i.baseCountry.toUpperCase() : null;
  return { ok: true, patch };
}

export function inQuietHours(q: WatcherSettings["quietHours"], now: Date): boolean {
  if (!q.enabled) return false;
  const [sh, sm] = q.start.split(":").map(Number);
  const [eh, em] = q.end.split(":").map(Number);
  const cur = now.getUTCHours() * 60 + now.getUTCMinutes(); // timezone conversion is a later step; UTC for now
  const s = sh! * 60 + sm!;
  const e = eh! * 60 + em!;
  return s <= e ? cur >= s && cur < e : cur >= s || cur < e;
}
