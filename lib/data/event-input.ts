import { z } from "zod";
import { EVENT_TYPES, SEVERITY_LEVELS } from "@/lib/types";
import { DB_VERIFICATION_STATUSES, LOCATION_PRECISIONS } from "@/lib/types/db";

const eventFields = z.object({
  title: z.string().trim().min(1),
  summary: z.string().trim().min(1),
  eventType: z.enum(EVENT_TYPES),
  locationName: z.string().nullable().optional(),
  countryCode: z.string().nullable().optional(),
  region: z.string().nullable().optional(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  locationPrecision: z.enum(LOCATION_PRECISIONS).nullable().optional(),
  occurredAt: z.string().datetime({ offset: true }),
  severity: z.enum(SEVERITY_LEVELS),
  importance: z.number().int().min(0).max(100).optional(),
  verificationStatus: z.enum(DB_VERIFICATION_STATUSES).optional(),
  conflictId: z.string().nullable().optional(),
});

export const editEventInput = eventFields.partial();
export const createEventInput = eventFields.extend({
  published: z.boolean().default(false),
  sourceName: z.string().trim().min(1),
  sourceUrl: z.string().trim().refine((value) => {
    if (!value) return true;
    try { return ["http:", "https:"].includes(new URL(value).protocol); } catch { return false; }
  }).optional(),
  sourceCategory: z.string().optional(),
});
