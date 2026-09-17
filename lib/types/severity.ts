export const SEVERITY_LEVELS = [
  "stable",
  "guarded",
  "elevated",
  "high",
  "severe",
  "extreme",
] as const;

export type Severity = (typeof SEVERITY_LEVELS)[number];

export const VERIFICATION_STATUSES = [
  "unverified",
  "reported",
  "multiple_sources",
  "confirmed",
  "official_claim",
] as const;

export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

export const EXPOSURE_DIMENSIONS = [
  "security",
  "energy",
  "trade",
  "finance",
  "food_supply",
] as const;

export type ExposureDimension = (typeof EXPOSURE_DIMENSIONS)[number];

// Original Phase 1 categories are kept exactly as-is (existing mock data
// uses these values) and the map-upgrade spec's fuller category list is
// added alongside rather than renaming/removing anything — e.g. "ground"
// and "ground_clash" both exist and share the same marker icon. See
// lib/map/event-icons.ts and Map Requirements.md in the Obsidian vault.
//
// earthquake/flood/storm/humanitarian/health added for the multi-source
// ingestion milestone: GDACS Disaster Alerts (a seeded real source) is
// entirely natural-disaster content, and WHO/ReliefWeb produce
// health/humanitarian reports — without these, that real, currently-
// flowing content had no meaningful category and fell into "other" (see
// lib/ingestion/event-type-keywords.ts for the matching keywords).
export const EVENT_TYPES = [
  "airstrike",
  "drone",
  "missile",
  "explosion",
  "artillery",
  "ground",
  "ground_clash",
  "naval",
  "air_defense",
  "protest",
  "civil_unrest",
  "fire",
  "security",
  "terrorism",
  "cyber",
  "border",
  "diplomacy",
  "sanctions",
  "infrastructure",
  "conflict",
  "earthquake",
  "flood",
  "storm",
  "humanitarian",
  "health",
  "other",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export const REGIONS = [
  "Europe",
  "Middle East",
  "Africa",
  "Asia",
  "Americas",
] as const;

export type Region = (typeof REGIONS)[number];
