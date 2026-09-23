// Territorial datasets: client-safe vocabulary. The distinction between CONTROL, INFLUENCE and PRESENCE is
// deliberate and permanent: a source that supports only presence or influence must never be shown, worded or coloured
// as territorial control, and none of them is ever inferred from attacks, incidents, sightings or news volume.

export const TERRITORIAL_DATASET_TYPES = ["TERRITORIAL_CONTROL", "CONTESTED_CONTROL", "INFLUENCE", "PRESENCE"] as const;
export type TerritorialDatasetType = (typeof TERRITORIAL_DATASET_TYPES)[number];

export const DATASET_TYPE_LABEL: Record<TerritorialDatasetType, string> = {
  TERRITORIAL_CONTROL: "Territorial control",
  CONTESTED_CONTROL: "Contested control",
  INFLUENCE: "Influence",
  PRESENCE: "Presence",
};

export type TerritoryKind = "control" | "influence" | "presence";
export const TERRITORY_KIND_LABEL: Record<TerritoryKind, string> = { control: "Control", influence: "Influence", presence: "Presence" };

export const kindOfDatasetType = (t: string): TerritoryKind => (t === "INFLUENCE" ? "influence" : t === "PRESENCE" ? "presence" : "control");
export const datasetTypeOfKind = (k: TerritoryKind): TerritorialDatasetType => (k === "influence" ? "INFLUENCE" : k === "presence" ? "PRESENCE" : "TERRITORIAL_CONTROL");

export type DatasetFilter = "all" | "control" | "contested" | "influence";
export const DATASET_FILTER_LABEL: Record<DatasetFilter, string> = { all: "All", control: "Control", contested: "Contested", influence: "Influence / Presence" };

export const matchesDatasetFilter = (type: string, filter: DatasetFilter): boolean => {
  if (filter === "all") return true;
  if (filter === "control") return type === "TERRITORIAL_CONTROL";
  if (filter === "contested") return type === "CONTESTED_CONTROL";
  return type === "INFLUENCE" || type === "PRESENCE";
};

/** A dataset that the map can actually show: a registry entry with published geometry. */
export interface PublicTerritorialDataset {
  id: string;
  name: string;
  conflictId: string | null;
  conflictSlug: string | null;
  conflictName: string | null;
  countryCodes: string[];
  datasetType: TerritorialDatasetType;
  kind: TerritoryKind;
  provider: string;
  sourceUrl: string | null;
  license: string | null;
  attribution: string | null;
  coverageDescription: string | null;
  lastUpdated: string | null;
  /** First and last time a published version of this dataset is valid (its history span). */
  validFrom: string | null;
  validTo: string | null;
  actors: string[];
  areaCount: number;
  versionCount: number;
  confidence: number | null;
  reviewStatus: string;
  /** true when more than one dated version exists, so the timeline shows different states. */
  hasHistory: boolean;
}

export type CoverageState = "HAS_CONTROL_DATA" | "HAS_PRESENCE_DATA" | "PENDING_REVIEW" | "STALE" | "SOURCE_CANDIDATE" | "NO_DATA";
export const COVERAGE_STATE_LABEL: Record<CoverageState, string> = {
  HAS_CONTROL_DATA: "Has control data",
  HAS_PRESENCE_DATA: "Has presence / influence data",
  PENDING_REVIEW: "Geometry pending review",
  STALE: "Stale",
  SOURCE_CANDIDATE: "Source candidate",
  NO_DATA: "No data",
};
/** Published geometry older than this is reported as stale in the coverage view. */
export const STALE_AFTER_DAYS = 180;
