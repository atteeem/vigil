import type { Event } from "@prisma/client";
import { alertsForEvent } from "@/lib/alerts/hooks";
import { prisma } from "@/lib/db/client";
import { propagateEntityLinksToEvent } from "@/lib/military/link-entities";
import { ADMIN_REGIONS } from "@/lib/geocoding/admin-regions";
import { gazetteerLookup } from "@/lib/geocoding/gazetteer";
import { linkEventSource } from "@/lib/db/repositories/event-sources";
import { setProcessingStatus } from "@/lib/db/repositories/raw-ingestion-items";
import { proposeEventUpdatesFromReport } from "@/lib/db/repositories/event-updates";
import { isAggregatorRole } from "@/lib/registry/source-tiers";
import { findCanonicalEventMatch, type CanonicalEventMatch } from "@/lib/ingestion/event-match";
import type { EventType, Severity } from "@/lib/types";
import type { DbVerificationStatus, LocationPrecision, LocationScope } from "@/lib/types/db";
import { LOCATION_PRECISIONS, LOCATION_SCOPES } from "@/lib/types/db";

// THE publish path for a raw incoming item: the single-item Publish action, the review form and "Publish filtered"
// all call publishRawItem, so validation and provenance are identical everywhere. It creates an Event linked to the
// item as its originating source (the item's original URL is untouched: the source link is read from the item),
// marks the item published, carries linked military entities over and notifies the alert service. It never runs
// without a person's action (spec §9).
//
// Event Clustering v1: before creating a NEW event, checks lib/ingestion/event-match.ts's canonical
// matcher — if a real, currently-published event strongly matches (same explicit place, tight
// event-type-specific time window, same event type, real title/fact overlap), this report ATTACHES to it
// instead (the same mechanism the manual "Merge" admin action already used —
// app/api/admin/incoming/[id]/merge/route.ts — this just adds an automatic, much stricter trigger for
// it). The item's processingStatus becomes "merged", not "published", and any conflicting extracted
// facts (casualties, etc.) become pending EventUpdateProposal rows for a human to resolve — never
// silently overwritten.

export interface PublishInput {
  title: string;
  summary: string;
  eventType: EventType;
  severity: Severity;
  occurredAt: string;
  importance?: number;
  verificationStatus?: DbVerificationStatus;
  conflictId?: string | null;
  // Geography. `locationScope` may be omitted by older callers: coordinates then mean "point", none means "unknown".
  locationScope?: LocationScope;
  countryCode?: string | null;
  region?: string | null; // macro region ("Europe")
  adminRegion?: string | null;
  city?: string | null;
  locationName?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  locationPrecision?: string | null;
  locationEvidence?: string | null;
}

export class PublishError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

export interface NormalizedLocation {
  scope: LocationScope;
  precision: LocationPrecision;
  latitude: number | null;
  longitude: number | null;
  countryCode: string | null;
  adminRegion: string | null;
  city: string | null;
}

const isNum = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

/** Applies the geographic rules to a publish request: which fields each scope requires, which coordinates it may
 * keep, and the precision it implies. Precision describes what is KNOWN: a region or city centroid is a render point
 * and stays "region" / "city"; country, global and unknown reports never keep a point. */
export function normalizeLocation(input: Pick<PublishInput, "locationScope" | "countryCode" | "adminRegion" | "city" | "latitude" | "longitude" | "locationPrecision">): NormalizedLocation {
  const hasPointInput = isNum(input.latitude) && isNum(input.longitude);
  const scope: LocationScope = input.locationScope && (LOCATION_SCOPES as readonly string[]).includes(input.locationScope) ? input.locationScope : hasPointInput ? "point" : "unknown";
  const countryCode = input.countryCode?.trim().toUpperCase() || null;
  const adminRegion = input.adminRegion?.trim() || null;
  const city = input.city?.trim() || null;
  const base = { scope, countryCode, adminRegion, city, latitude: null as number | null, longitude: null as number | null };
  const legacyPrecision = (LOCATION_PRECISIONS as readonly string[]).includes(input.locationPrecision ?? "") ? (input.locationPrecision as LocationPrecision) : null;

  switch (scope) {
    case "global":
      return { ...base, countryCode: null, adminRegion: null, city: null, precision: "unknown" };
    case "unknown":
      return { ...base, precision: "unknown" };
    case "country":
      if (!countryCode) throw new PublishError("Country scope needs a country.");
      return { ...base, adminRegion: null, city: null, precision: "country" };
    case "region": {
      if (!adminRegion) throw new PublishError("Region scope needs the region (oblast / province / state).");
      if (!countryCode) throw new PublishError("Region scope needs the country the region is in.");
      const known = ADMIN_REGIONS.find((r) => r.countryCode === countryCode && r.name.toLowerCase() === adminRegion.toLowerCase());
      const point = hasPointInput ? { latitude: input.latitude!, longitude: input.longitude! } : known ? { latitude: known.lat, longitude: known.lng } : { latitude: null, longitude: null };
      return { ...base, city: null, ...point, precision: "region" };
    }
    case "city": {
      if (!city) throw new PublishError("City scope needs the city.");
      let point = hasPointInput ? { latitude: input.latitude!, longitude: input.longitude! } : null;
      if (!point) {
        const hits = gazetteerLookup(city).filter((h) => !countryCode || h.countryCode === countryCode);
        if (hits.length === 1) point = { latitude: hits[0]!.lat, longitude: hits[0]!.lng };
      }
      if (!point) throw new PublishError(`Coordinates for "${city}" could not be resolved: enter them, or publish at region or country scope.`);
      return { ...base, ...point, precision: "city" };
    }
    case "point":
      if (!hasPointInput) throw new PublishError("An exact point needs latitude and longitude.");
      return { ...base, latitude: input.latitude!, longitude: input.longitude!, precision: legacyPrecision && ["exact", "approximate", "unknown"].includes(legacyPrecision) ? legacyPrecision : input.locationScope ? "exact" : "unknown" };
  }
}

function slugify(title: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 60);
  return `${base || "event"}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** Attaches a report to an existing event instead of creating a new one — the automatic counterpart to
 * app/api/admin/incoming/[id]/merge/route.ts's manual action, same underlying steps. An aggregator/relay
 * report is never independent confirmation regardless of the match, so it's always attached as "relay". */
async function attachToExistingEvent(rawItem: { id: string; source: { sourceRole: string | null } }, match: CanonicalEventMatch): Promise<Event> {
  const relationship = isAggregatorRole(rawItem.source.sourceRole) ? "relay" : "corroborating";
  const event = await prisma.event.findUniqueOrThrow({ where: { id: match.eventId } });
  await linkEventSource(match.eventId, rawItem.id, relationship, relationship !== "relay");
  await setProcessingStatus(rawItem.id, "merged");
  await proposeEventUpdatesFromReport(match.eventId, rawItem.id); // conflicting facts become pending proposals, never silently overwritten
  await propagateEntityLinksToEvent(rawItem.id, match.eventId);
  await alertsForEvent(match.eventId);
  return event;
}

export async function publishRawItem(rawItemId: string, input: PublishInput): Promise<Event> {
  if (!input.title?.trim() || !input.summary?.trim() || !input.eventType) throw new PublishError("title, summary and eventType are required");
  if (!input.severity) throw new PublishError("severity is required");
  const occurredAt = new Date(input.occurredAt);
  if (Number.isNaN(occurredAt.getTime())) throw new PublishError("occurredAt is not a valid date");
  const loc = normalizeLocation(input);
  if (loc.latitude != null && (loc.latitude < -90 || loc.latitude > 90)) throw new PublishError("Latitude must be between -90 and 90.");
  if (loc.longitude != null && (loc.longitude < -180 || loc.longitude > 180)) throw new PublishError("Longitude must be between -180 and 180.");

  const rawItem = await prisma.rawIngestionItem.findUnique({ where: { id: rawItemId }, include: { source: { select: { sourceRole: true } } } });
  if (!rawItem) throw new PublishError("Raw item not found", 404);
  if (rawItem.processingStatus === "published" || rawItem.processingStatus === "merged") throw new PublishError("This item has already been published.", 409);

  const canonicalMatch = await findCanonicalEventMatch({
    title: input.title,
    eventType: input.eventType,
    latitude: loc.latitude,
    longitude: loc.longitude,
    countryCode: loc.countryCode,
    region: input.region ?? null,
    conflictId: input.conflictId ?? null,
    occurredAt,
  });
  if (canonicalMatch) return attachToExistingEvent(rawItem, canonicalMatch);

  const event = await prisma.$transaction(async (tx) => {
    const created = await tx.event.create({
      data: {
        slug: slugify(input.title),
        title: input.title.trim(),
        summary: input.summary.trim(),
        eventType: input.eventType,
        locationName: input.locationName || loc.city || loc.adminRegion || null,
        latitude: loc.latitude,
        longitude: loc.longitude,
        locationPrecision: loc.precision,
        locationScope: loc.scope,
        city: loc.city,
        adminRegion: loc.adminRegion,
        locationEvidence: input.locationEvidence || null,
        countryCode: loc.countryCode,
        region: input.region || null,
        conflictId: input.conflictId ?? null,
        occurredAt,
        severity: input.severity,
        importance: input.importance ?? 50,
        verificationStatus: input.verificationStatus ?? "reported",
        published: true,
        publishedAt: new Date(),
      },
    });
    await tx.eventSource.create({ data: { eventId: created.id, rawIngestionItemId: rawItem.id, relationship: "originating", isOriginatingSource: true } });
    await tx.rawIngestionItem.update({ where: { id: rawItem.id }, data: { processingStatus: "published" } });
    return created;
  });

  // Units the entity extractor already linked to this article carry over to the new Event (actor -> events).
  await propagateEntityLinksToEvent(rawItem.id, event.id);
  await alertsForEvent(event.id);
  return event;
}
