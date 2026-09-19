// Central Conflict Scoring Engine v1 — single entry point. Every consumer
// (heatmap, conflict pages, admin, future sorting/filtering/ranking)
// imports from here rather than reaching into individual engine files, so
// there is exactly one place scoring logic is assembled.
export { computeSeverityScore, type SeverityScoreInput } from "./severity";
export { computeImpactScore, type ImpactScoreInput } from "./impact";
export { aggregateExposure, combineDamped, BORDER_WAR_EXPOSURE_FLOOR, type ExposureConflictInput, type ExposureResult } from "./exposure";
export { computeConfidenceScore, type ConfidenceScoreInput } from "./confidence";
export { isSameCountry, isDirectlyBordering, countryDistanceKm, buildAdjacency, DEFAULT_ADJACENCY, type AdjacencyMap, type GeoPoint } from "./geography";
export type { SeverityScoreResult, ImpactScoreResult, ConfidenceScoreResult, ConflictStatusLike, HardFloor } from "./types";
