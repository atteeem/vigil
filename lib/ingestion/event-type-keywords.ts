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
  ["fire", ["wildfire", "fire broke out", "blaze"]],
  ["cyber", ["cyberattack", "cyber attack", "hacked", "data breach", "ransomware"]],
  ["border", ["border crossing", "border clash", "border incident"]],
  ["diplomacy", ["summit", "peace talks", "ceasefire", "negotiat", "diplomat"]],
  ["sanctions", ["sanction"]],
  ["infrastructure", ["power grid", "pipeline", "infrastructure", "water supply"]],
  ["terrorism", ["terrorist", "terror attack", "suicide bomb"]],
  ["security", ["security operation", "raid", "arrest"]],
];

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
