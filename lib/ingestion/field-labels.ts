import type { ExtractedFactField } from "@/lib/types/db";

// Shared display labels for ExtractedFactField — used by both the
// Structured Facts review panel (app/admin/incoming/page.tsx) and the
// Live Event Updates proposal/history panels (app/admin/events/[id]/
// page.tsx), since both surfaces show the same field vocabulary.
export const EXTRACTED_FACT_FIELD_LABEL: Record<ExtractedFactField, string> = {
  eventType: "Event type",
  title: "Title",
  summary: "Summary",
  countryCode: "Country",
  region: "Region",
  locationName: "Location name",
  latitude: "Latitude",
  longitude: "Longitude",
  occurredAt: "Occurred at",
  actor: "Actor",
  casualtiesKilled: "Killed",
  casualtiesInjured: "Injured",
  infrastructureDamage: "Infrastructure damage",
  severity: "Severity",
  conflictId: "Conflict",
};
