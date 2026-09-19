import registry from "@/data/conflict-registry.json";

// Typed access to the curated Global Conflict Registry (data/conflict-registry.json).
// The same file seeds the database (prisma/seed.mjs) and supplies the
// geography the mock conflict data uses (lib/data/mock-conflicts.ts), so the
// scoring engine, map, admin and territorial control all read one set of facts.

export interface RegistryActorLink {
  name: string;
  role: "belligerent" | "participant" | "supporter";
}

export interface RegistryConflict {
  slug: string;
  mockSlug?: string;
  name: string;
  shortName: string;
  region: string;
  regions: string[];
  startedAt: string | null;
  fullScaleWar: boolean;
  familySlug?: string;
  /** Present on entries that add a conflict (existing DB rows keep their own). */
  status?: "active" | "reduced" | "dormant" | "ended";
  /** Correct an existing row's status (a tension recorded as "active" fighting). */
  statusAudit?: boolean;
  severity?: string;
  intensity?: number;
  lat?: number;
  lng?: number;
  primaryEffects?: string[];
  summary?: string;
  fightingCountries: string[];
  participantCountries: string[];
  supporterCountries: string[];
  classification: { confidence: "established" | "uncertain" | "disputed"; note: string };
  actors: RegistryActorLink[];
  dedicatedSources?: string[];
  territorialControl?: boolean;
}

export interface RegistryFamily {
  slug: string;
  name: string;
  description: string;
}

export interface RegistryTracker {
  name: string;
  url: string;
  covers: string[];
}

export interface RegistrySourceCandidate {
  conflictSlug: string;
  name: string;
  url: string;
  sourceType: string;
  language: string;
}

export const REGISTRY_CURATED_AT: string = registry.curatedAt;
export const REGISTRY_TRACKERS = registry.trackers as RegistryTracker[];
export const REGISTRY_FAMILIES = registry.families as RegistryFamily[];
export const REGISTRY_CONFLICTS = registry.conflicts as unknown as RegistryConflict[];
export const REGISTRY_SOURCE_CANDIDATES = registry.sourceCandidates as RegistrySourceCandidate[];

export function registryEntry(slug: string): RegistryConflict | undefined {
  return REGISTRY_CONFLICTS.find((c) => c.slug === slug);
}

export function registryEntryByMockSlug(mockSlug: string): RegistryConflict | undefined {
  return REGISTRY_CONFLICTS.find((c) => c.mockSlug === mockSlug);
}

/** Registry conflicts by family slug — members stay separate records. */
export function familyMembers(familySlug: string): RegistryConflict[] {
  return REGISTRY_CONFLICTS.filter((c) => c.familySlug === familySlug);
}
