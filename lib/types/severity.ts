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

export const EVENT_TYPES = [
  "airstrike",
  "drone",
  "ground",
  "naval",
  "terrorism",
  "civil_unrest",
  "cyber",
  "diplomacy",
  "sanctions",
  "conflict",
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
