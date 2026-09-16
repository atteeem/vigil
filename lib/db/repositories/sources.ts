import { prisma } from "@/lib/db/client";
import type { Source } from "@prisma/client";
import type { PermissionStatus, SourceType, SourceRole } from "@/lib/types/db";

// Repository abstraction over the Source table. UI/route-handler code
// should import from here, never from `@prisma/client` directly — that's
// what lets this be swapped for a Supabase-backed implementation later
// without touching callers (see PROJECT.md / Decisions.md "Current backend
// strategy").

export interface SourceInput {
  name: string;
  type: SourceType;
  url?: string | null;
  telegramHandle?: string | null;
  country?: string | null;
  region?: string | null;
  language?: string | null;
  sourceCategory?: string | null;
  reliabilityTier?: string | null;
  sourceRole?: SourceRole | null;
  permissionStatus?: PermissionStatus;
  enabled?: boolean;
  autoIngest?: boolean;
  autoProcessing?: boolean;
  pollIntervalMinutes?: number;
}

export function listSources(): Promise<Source[]> {
  return prisma.source.findMany({ orderBy: { createdAt: "asc" } });
}

export function getSource(id: string): Promise<Source | null> {
  return prisma.source.findUnique({ where: { id } });
}

export function createSource(input: SourceInput): Promise<Source> {
  return prisma.source.create({ data: input });
}

export function updateSource(id: string, input: Partial<SourceInput>): Promise<Source> {
  return prisma.source.update({ where: { id }, data: input });
}

export function setSourceEnabled(id: string, enabled: boolean): Promise<Source> {
  return prisma.source.update({ where: { id }, data: { enabled } });
}

export function deleteSource(id: string): Promise<Source> {
  return prisma.source.delete({ where: { id } });
}

export function recordIngestionSuccess(id: string): Promise<Source> {
  return prisma.source.update({
    where: { id },
    data: { lastSuccessfulIngestion: new Date(), lastError: null, consecutiveFailures: 0 },
  });
}

export function recordIngestionError(id: string, error: string): Promise<Source> {
  return prisma.source.update({
    where: { id },
    data: { lastError: error, consecutiveFailures: { increment: 1 } },
  });
}

/** Always called at the start of a poll attempt (scheduled or manual "Fetch
 * Now") — this is the one place `lastAttemptedAt` is set, independent of
 * whether the attempt goes on to succeed or fail. */
export function recordAttemptStarted(id: string): Promise<Source> {
  return prisma.source.update({ where: { id }, data: { lastAttemptedAt: new Date() } });
}

export function scheduleNextPoll(id: string, nextPollAt: Date): Promise<Source> {
  return prisma.source.update({ where: { id }, data: { nextPollAt } });
}
