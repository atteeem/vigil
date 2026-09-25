// Client-safe search vocabulary (lib/public/search.ts pulls in the database client).

export const SEARCH_GROUPS = ["Countries", "Conflicts", "Actors", "Military", "Places", "Live Events", "Infrastructure", "Sources"] as const;
export type SearchGroup = (typeof SEARCH_GROUPS)[number];

export type SearchResultType = "country" | "conflict" | "actor" | "unit" | "commander" | "equipment" | "region" | "city" | "event" | "hazard" | "airport" | "port" | "chokepoint" | "infrastructure" | "source";

export interface SearchResult {
  type: SearchResultType;
  group: SearchGroup;
  id: string;
  title: string;
  /** Kind of thing, shown first ("Actor", "Region", "Port"...). */
  kind: string;
  /** Country / region context that distinguishes same-named results. */
  context: string | null;
  /** Status / role when relevant ("Active", "Belligerent", "disrupted"). */
  status: string | null;
  /** Short secondary line (matched alias, dates, precision). */
  subtitle: string;
  href: string;
}
