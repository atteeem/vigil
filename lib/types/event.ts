import type { EventType, Severity, VerificationStatus } from "./severity";

export interface SourceRef {
  id: string;
  name: string;
  sourceType: "Wire" | "Official" | "Local News" | "News" | "OSINT" | "Social" | "NGO";
  /** Trust-model classification (lib/types/db.ts SourceRole) — only set
   * for real DB-backed sources, not mock data. Drives the source icon
   * (components/events/source-role-icon.tsx); a missing/unrecognized
   * value always falls back to a generic source icon, never a blank one. */
  sourceRole?: string | null;
  url: string;
  publishedAt: string; // ISO datetime
  note?: string;
}

/** A single accepted change from an event's immutable history ledger
 * (Live Event Updates spec) — deliberately loose/display-only typing
 * here (no ExtractedFactField import) since lib/types/event.ts is the
 * plain public-facing model, kept independent of DB-specific types. */
export interface EventUpdateHistoryEntry {
  field: string;
  oldValue: string | null;
  newValue: string;
  changedAt: string; // ISO datetime
}

export interface ConflictEvent {
  id: string;
  slug: string;
  title: string;
  summary: string;
  eventType: EventType;
  lat: number;
  lng: number;
  countryCode: string;
  region: string;
  conflictId: string | null;
  occurredAt: string; // ISO datetime
  severity: Severity;
  importance: number; // 0-100
  verificationStatus: VerificationStatus;
  disputed: boolean;
  sourceCount: number;
  sources: SourceRef[];
  timeline: { label: string; time: string; description: string }[];
  // Live Event Updates (spec "Live Event Updates"): all optional and
  // omitted for mock events — only DB-backed events populate them.
  // createdAt/updatedAt power "updated X ago" on the public page (only
  // shown when updatedAt is meaningfully later than createdAt, i.e. an
  // accepted change actually happened, not just on every event).
  createdAt?: string;
  updatedAt?: string;
  // Populated only via an accepted EventUpdateProposal — never by direct
  // manual entry (see prisma/schema.prisma's Event model comment).
  actors?: string[];
  casualtiesKilled?: number | null;
  casualtiesInjured?: number | null;
  infrastructureDamage?: string[];
  // Concise, public-safe update history (spec "optionally show a concise
  // update history") — every row here is already an ACCEPTED change by
  // construction (see EventHistoryEntryDTO), so no extra filtering is
  // needed before showing it.
  updateHistory?: EventUpdateHistoryEntry[];
}
