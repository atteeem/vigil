// Territorial Control Mode — type-level boundary for the new
// ConflictActor/ConflictTerritory tables (see prisma/schema.prisma for
// the versioning model). Mirrors lib/types/db.ts's own "validate the
// SQLite plain-String columns at the TypeScript boundary" convention.

// "recently_changed" is a presentation state (a row still gets here via
// normal validFrom/validTo versioning — see supersedeTerritory) rather
// than a separate lifecycle: it just means "this version's validFrom is
// within RECENTLY_CHANGED_WINDOW_MS of the query time," computed at read
// time, never stored. Admins pick "controlled"/"contested"/"uncertain"
// when creating a version; "recently_changed" only ever appears in
// reconstructed output. See lib/data/territorial-control.ts.
export const TERRITORIAL_STATUSES = ["controlled", "contested", "uncertain", "recently_changed"] as const;
export type TerritorialStatus = (typeof TERRITORIAL_STATUSES)[number];

// Statuses an admin actually assigns when creating/superseding a version
// — "recently_changed" is derived, never entered directly (see above).
export const ASSIGNABLE_TERRITORIAL_STATUSES = ["controlled", "contested", "uncertain"] as const;
export type AssignableTerritorialStatus = (typeof ASSIGNABLE_TERRITORIAL_STATUSES)[number];

export type TerritorialGeometry = GeoJSON.Polygon | GeoJSON.MultiPolygon;

export interface ConflictActorDTO {
  id: string;
  conflictId: string;
  name: string;
  color: string;
  createdAt: string;
}

// Never presented as a legal sovereignty determination (spec §2/§9) —
// `status`/`confidence` are explicitly a claim about reported/de facto
// control, not a boundary ruling.
export interface TerritoryDTO {
  id: string;
  conflictId: string;
  conflictName: string;
  actorId: string | null;
  actorName: string | null;
  actorColor: string;
  status: TerritorialStatus;
  confidence: number;
  geometry: TerritorialGeometry;
  sourceName: string | null;
  sourceUrl: string | null;
  validFrom: string;
  validTo: string | null;
  published: boolean;
  /** Draft: the active version this draft partially changes. Published: the version this row was split from. */
  splitFromId: string | null;
  createdAt: string;
  updatedAt: string;
}

// Feature.properties for the public GeoJSON FeatureCollection the map
// consumes — a flattened, string/number-only subset of TerritoryDTO
// (MapLibre feature-state/paint expressions can't read nested objects),
// consumed by lib/map/territorial-to-geojson.ts and the click-to-inspect
// panel in components/map/territory-detail-panel.tsx.
export interface TerritoryFeatureProperties {
  id: string;
  conflictId: string;
  conflictName: string;
  actorId: string | null;
  actorName: string | null;
  actorColor: string;
  status: TerritorialStatus;
  confidence: number;
  sourceName: string | null;
  sourceUrl: string | null;
  validFrom: string;
  validTo: string | null;
  lastUpdated: string;
}
