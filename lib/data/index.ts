export * from "./constants";
export * from "./mock-countries";
export * from "./mock-conflicts";
export * from "./mock-events";
export * from "./mock-markets";
export * from "./mock-sources";
export * from "./impact";
export * from "./global-status";

import { MOCK_COUNTRIES } from "./mock-countries";
import { MOCK_CONFLICTS } from "./mock-conflicts";
import { MOCK_EVENTS } from "./mock-events";
import { MOCK_MARKETS } from "./mock-markets";

export interface SearchResult {
  type: "country" | "conflict" | "event" | "market";
  id: string;
  title: string;
  subtitle: string;
  href: string;
}

export function searchAll(query: string, limit = 8): SearchResult[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const results: SearchResult[] = [];

  for (const c of MOCK_COUNTRIES) {
    if (c.name.toLowerCase().includes(q) || c.code.toLowerCase() === q) {
      results.push({
        type: "country",
        id: c.code,
        title: c.name,
        subtitle: c.region,
        href: `/country/${c.code}`,
      });
    }
  }
  for (const c of MOCK_CONFLICTS) {
    if (c.name.toLowerCase().includes(q) || c.shortName.toLowerCase().includes(q)) {
      results.push({
        type: "conflict",
        id: c.id,
        title: c.shortName,
        subtitle: `${c.region} · Severity: ${c.severity}`,
        href: `/conflict/${c.slug}`,
      });
    }
  }
  for (const m of MOCK_MARKETS) {
    if (m.name.toLowerCase().includes(q) || m.symbol.toLowerCase().includes(q)) {
      results.push({
        type: "market",
        id: m.id,
        title: m.name,
        subtitle: m.assetClass,
        href: `/markets/${m.id}`,
      });
    }
  }
  for (const e of MOCK_EVENTS) {
    if (e.title.toLowerCase().includes(q)) {
      results.push({
        type: "event",
        id: e.id,
        title: e.title,
        subtitle: `${e.region} · ${new Date(e.occurredAt).toLocaleDateString("en-US")}`,
        href: `/event/${e.slug}`,
      });
    }
  }

  return results.slice(0, limit);
}
