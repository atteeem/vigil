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
}
