import type { EventType } from "@/lib/types";

// Deliberately simple keyword matching, not AI/NLP — a fast, deterministic,
// fully-testable heuristic for the automated draft-extraction stage (spec
// §3). First category whose keyword list matches wins; keyword order
// within EVENT_TYPE_KEYWORDS is checked in declaration order, so more
// specific categories are listed before their broader neighbors.
export const EVENT_TYPE_KEYWORDS: [EventType, string[]][] = [
  ["missile", ["missile", "ballistic missile", "cruise missile"]],
  ["drone", ["drone", "uav", "shahed"]],
  ["airstrike", ["airstrike", "air strike", "air raid", "bombing raid", "warplane"]],
  ["artillery", ["artillery", "shelling", "shelled", "mortar"]],
  ["explosion", ["explosion", "blast", "detonat"]],
  ["naval", ["naval", "warship", "frigate", "vessel attack", "port attack"]],
  ["air_defense", ["air defense", "air defence", "intercepted", "interceptor"]],
  ["ground_clash", ["ground clash", "firefight", "gun battle", "clashes", "offensive", "counteroffensive"]],
  ["protest", ["protest", "demonstration", "rally"]],
  ["civil_unrest", ["riot", "unrest", "civil unrest"]],
  // "forest fire notification" (GDACS Disaster Alerts' real wording) is
  // distinct from "wildfire" — both are checked so the seeded real source
  // actually classifies instead of falling through to "other".
  ["fire", ["wildfire", "forest fire", "fire broke out", "blaze"]],
  ["cyber", ["cyberattack", "cyber attack", "hacked", "data breach", "ransomware"]],
  ["border", ["border crossing", "border clash", "border incident"]],
  ["diplomacy", ["summit", "peace talks", "ceasefire", "negotiat", "diplomat"]],
  ["sanctions", ["sanction"]],
  ["infrastructure", ["power grid", "pipeline", "infrastructure", "water supply"]],
  ["terrorism", ["terrorist", "terror attack", "suicide bomb"]],
  ["security", ["security operation", "raid", "arrest"]],
  // Natural-disaster categories — real GDACS Disaster Alerts wording
  // ("Green earthquake (Magnitude...)", "Green flood alert...", "Green/
  // Orange notification for tropical cyclone...").
  ["earthquake", ["earthquake", "seismic", "magnitude"]],
  ["flood", ["flood alert", "flooding", "flash flood", "flood warning"]],
  ["storm", ["tropical cyclone", "hurricane", "typhoon", "tropical storm"]],
  // Real ReliefWeb/GDACS wording ("Drought is on going in...") and
  // generic humanitarian-crisis language.
  ["humanitarian", ["drought", "humanitarian crisis", "famine", "displacement", "refugee crisis"]],
  // Real WHO News wording ("...Global Health...", "health priorities",
  // "World Health Assembly", "pandemic agreement").
  ["health", ["pandemic", "disease outbreak", "epidemic", "health emergency", "world health", "global health"]],
];

// Real-data audit finding: draft.ts used to link ANY item whose location
// resolved to a country to that country's one tracked conflict, regardless
// of topic — a tourism, trade, or weather story about Mexico was suggested
// as a "Mexico cartel violence" event purely because it mentioned a
// Mexican place name. These event types are never armed-conflict violence
// by definition (natural hazard, health, or uncategorized), so an item
// classified as one of them should never carry a conflict suggestion.
export const NON_CONFLICT_EVENT_TYPES: ReadonlySet<EventType> = new Set(["other", "earthquake", "flood", "storm", "fire", "health"]);

export function detectEventType(text: string): EventType {
  const lower = text.toLowerCase();
  for (const [type, keywords] of EVENT_TYPE_KEYWORDS) {
    if (keywords.some((k) => lower.includes(k))) return type;
  }
  return "other";
}

// Coarse severity/importance bump from casualty/escalation language — a
// conservative starting point only; the human reviewer sets the real
// values (spec §3 "Human can override everything").
const HIGH_SEVERITY_KEYWORDS = ["killed", "dead", "casualties", "deaths", "fatal"];

// Plain substring matching can't tell "3 killed" from "no casualties" —
// checking these negated phrasings first avoids that specific false
// positive. Still not real negation handling (e.g. won't catch "nobody
// was killed"), just the common newswire phrasings.
const NEGATED_SEVERITY_PHRASES = [
  "no casualties",
  "no deaths",
  "no fatalities",
  "no one killed",
  "nobody killed",
  "without casualties",
];

export function suggestSeverityAndImportance(text: string): { severity: string; importance: number } {
  const lower = text.toLowerCase();
  if (NEGATED_SEVERITY_PHRASES.some((p) => lower.includes(p))) {
    return { severity: "elevated", importance: 50 };
  }
  if (HIGH_SEVERITY_KEYWORDS.some((k) => lower.includes(k))) {
    return { severity: "high", importance: 65 };
  }
  return { severity: "elevated", importance: 50 };
}
