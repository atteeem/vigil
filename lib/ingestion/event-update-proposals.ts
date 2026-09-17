import type { Event } from "@prisma/client";
import type { ExtractedFactDTO, ExtractedFactField, EventUpdateChangeType } from "@/lib/types/db";
import { pickEffectiveFact, valuesDiffer } from "@/lib/ingestion/fact-diff";

/**
 * Live Event Updates (spec "Live Event Updates") — pure comparison logic
 * between one report's extracted facts and one event's current state.
 * Deliberately has zero Prisma/DB calls (Event is passed in as plain
 * data) so it's directly unit-testable and so "extraction separate from
 * event mutation, proposals separate from accepted event state" (spec
 * "Architecture") holds at the module level, not just by convention:
 * this file can only ever produce proposal DRAFTS, never write anything.
 * Persistence (and the actual field-name → Event-column mutation on
 * accept) lives in lib/db/repositories/event-updates.ts.
 */
export interface EventUpdateProposalDraft {
  field: ExtractedFactField;
  currentValue: string | null;
  proposedValue: string;
  confidence: number;
  source: string;
  observedAt: Date;
  changeType: EventUpdateChangeType;
}

// Plain scalar fields: one current value on Event, one proposed value per
// report (via pickEffectiveFact), straightforward equality/tolerance
// compare. Excludes the four fields below, which need array/multi-value
// handling instead.
const SCALAR_FIELDS: ExtractedFactField[] = [
  "eventType",
  "title",
  "summary",
  "locationName",
  "countryCode",
  "region",
  "latitude",
  "longitude",
  "occurredAt",
  "severity",
  "conflictId",
];

// actor/infrastructureDamage are genuinely multi-valued on Event (a JSON
// array — see prisma/schema.prisma) — every distinct non-rejected fact
// value NOT already in the event's array becomes its own "new" proposal,
// rather than trying to force many named actors into one "current vs.
// proposed" scalar comparison.
const LIST_FIELDS: ExtractedFactField[] = ["actor", "infrastructureDamage"];

// Single current figure on Event, but a report can carry more than one
// distinct reported number (spec "conflicting reports" — sources
// disagree) — every distinct non-rejected value that differs from the
// event's current figure becomes its own proposal, so two reports (or
// even one report's two conflicting facts) can produce two coexisting
// pending proposals rather than one silently picked.
const CASUALTY_FIELDS: ExtractedFactField[] = ["casualtiesKilled", "casualtiesInjured"];

function currentScalarValue(event: Event, field: ExtractedFactField): string | null {
  switch (field) {
    case "eventType":
      return event.eventType;
    case "title":
      return event.title;
    case "summary":
      return event.summary;
    case "locationName":
      return event.locationName;
    case "countryCode":
      return event.countryCode;
    case "region":
      return event.region;
    case "latitude":
      return String(event.latitude);
    case "longitude":
      return String(event.longitude);
    case "occurredAt":
      return event.occurredAt.toISOString();
    case "severity":
      return event.severity;
    case "conflictId":
      return event.conflictId;
    default:
      return null;
  }
}

export function parseJsonArray(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? (value as string[]) : [];
  } catch {
    return [];
  }
}

function currentListValue(event: Event, field: "actor" | "infrastructureDamage"): string[] {
  return parseJsonArray(field === "actor" ? event.actors : event.infrastructureDamage);
}

function currentCasualtyValue(event: Event, field: "casualtiesKilled" | "casualtiesInjured"): string | null {
  const value = field === "casualtiesKilled" ? event.casualtiesKilled : event.casualtiesInjured;
  return value === null ? null : String(value);
}

/** Builds every proposal draft this report's facts justify against this
 * event's current state — "unchanged fields create no proposal" falls
 * out of valuesDiffer/set-membership returning false for anything that
 * already matches. Does not de-duplicate against OTHER already-pending
 * proposals on the event (a report re-confirming an already-proposed
 * value is a caller/persistence-layer concern — see
 * lib/db/repositories/event-updates.ts). */
export function buildProposalDrafts(event: Event, facts: ExtractedFactDTO[]): EventUpdateProposalDraft[] {
  const drafts: EventUpdateProposalDraft[] = [];

  for (const field of SCALAR_FIELDS) {
    const fact = pickEffectiveFact(facts, field);
    if (!fact) continue;
    const current = currentScalarValue(event, field);
    if (!valuesDiffer(field, current, fact.value)) continue;
    drafts.push({
      field,
      currentValue: current,
      proposedValue: fact.value,
      confidence: fact.confidence,
      source: fact.source,
      observedAt: new Date(fact.observedAt),
      changeType: current === null ? "new" : "updated",
    });
  }

  for (const field of LIST_FIELDS as ("actor" | "infrastructureDamage")[]) {
    const existing = new Set(currentListValue(event, field));
    for (const fact of facts.filter((f) => f.field === field && f.status !== "rejected")) {
      if (existing.has(fact.value)) continue;
      drafts.push({
        field,
        currentValue: null,
        proposedValue: fact.value,
        confidence: fact.confidence,
        source: fact.source,
        observedAt: new Date(fact.observedAt),
        changeType: "new",
      });
    }
  }

  for (const field of CASUALTY_FIELDS as ("casualtiesKilled" | "casualtiesInjured")[]) {
    const current = currentCasualtyValue(event, field);
    const seenValues = new Set<string>();
    for (const fact of facts.filter((f) => f.field === field && f.status !== "rejected")) {
      if (seenValues.has(fact.value) || fact.value === current) continue;
      seenValues.add(fact.value);
      drafts.push({
        field,
        currentValue: current,
        proposedValue: fact.value,
        confidence: fact.confidence,
        source: fact.source,
        observedAt: new Date(fact.observedAt),
        changeType: current === null ? "new" : "updated",
      });
    }
  }

  return drafts;
}
