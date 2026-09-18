/**
 * Event Version History (spec "On admin event detail, add a
 * chronological update/history section... Casualties: 4 → 6, Severity
 * changed, Location refined, Conflict association updated"). Pure
 * string formatting, no DB — a small enough surface that it's worth
 * unit-testing directly rather than only eyeballing it in the admin UI.
 */
export interface DescribableHistoryEntry {
  field: string;
  oldValue: string | null;
  newValue: string;
}

const UNKNOWN = "unknown";

export function describeHistoryEntry(entry: DescribableHistoryEntry): string {
  const from = entry.oldValue ?? UNKNOWN;
  switch (entry.field) {
    case "casualtiesKilled":
      return `Killed: ${from} → ${entry.newValue}`;
    case "casualtiesInjured":
      return `Injured: ${from} → ${entry.newValue}`;
    case "severity":
      return `Severity changed: ${from} → ${entry.newValue}`;
    case "conflictId":
      return "Conflict association updated";
    case "locationName":
    case "countryCode":
    case "region":
    case "latitude":
    case "longitude":
      return "Location refined";
    case "actor":
      return `Actor identified: ${entry.newValue}`;
    case "infrastructureDamage":
      return `Infrastructure damage reported: ${entry.newValue}`;
    case "eventType":
      return `Event type changed: ${from} → ${entry.newValue}`;
    case "occurredAt":
      return "Event time refined";
    case "title":
      return "Title updated";
    case "summary":
      return "Summary updated";
    default:
      return `${entry.field} updated`;
  }
}
