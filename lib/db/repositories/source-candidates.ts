import { prisma } from "@/lib/db/client";

export const CANDIDATE_STATUSES = ["candidate", "approved", "integrated", "rejected"] as const;
export const CANDIDATE_SOURCE_TYPES = ["news", "local_media", "ngo", "official", "monitor", "social", "other"] as const;

export interface CandidateInput {
  name?: string;
  url?: string | null;
  conflictId?: string | null;
  sourceType?: string;
  language?: string | null;
  status?: string;
  notes?: string | null;
}

/** Validates a candidate body. Nothing here (or anywhere for candidates) ever
 * fetches the URL — a candidate is only a backlog note. */
export function validateCandidateInput(body: unknown, requireName: boolean): { ok: true; value: CandidateInput } | { ok: false; error: string } {
  if (typeof body !== "object" || body === null) return { ok: false, error: "A JSON body is required." };
  const b = body as CandidateInput;
  if (requireName && !b.name?.trim()) return { ok: false, error: "name is required." };
  if (b.status !== undefined && !(CANDIDATE_STATUSES as readonly string[]).includes(b.status)) return { ok: false, error: `status must be one of ${CANDIDATE_STATUSES.join(", ")}.` };
  if (b.sourceType !== undefined && !(CANDIDATE_SOURCE_TYPES as readonly string[]).includes(b.sourceType)) return { ok: false, error: `sourceType must be one of ${CANDIDATE_SOURCE_TYPES.join(", ")}.` };
  if (b.url) {
    try {
      if (!["http:", "https:"].includes(new URL(b.url).protocol)) throw new Error("bad protocol");
    } catch {
      return { ok: false, error: "url must be an http(s) URL." };
    }
  }
  return { ok: true, value: { ...b, name: b.name?.trim() } };
}

export function listSourceCandidates(filter: { conflictId?: string; status?: string } = {}) {
  return prisma.sourceCandidate.findMany({
    where: { conflictId: filter.conflictId, status: filter.status },
    include: { conflict: { select: { id: true, slug: true, name: true } } },
    orderBy: [{ createdAt: "asc" }],
  });
}

export function createSourceCandidate(input: CandidateInput) {
  return prisma.sourceCandidate.create({
    data: {
      name: input.name!,
      url: input.url ?? null,
      conflictId: input.conflictId ?? null,
      sourceType: input.sourceType ?? "news",
      language: input.language ?? null,
      status: input.status ?? "candidate",
      notes: input.notes ?? null,
    },
  });
}

export function updateSourceCandidate(id: string, input: CandidateInput) {
  const data: Record<string, unknown> = {};
  for (const key of ["name", "url", "conflictId", "sourceType", "language", "status", "notes"] as const) {
    if (input[key] !== undefined) data[key] = input[key];
  }
  return prisma.sourceCandidate.update({ where: { id }, data });
}

export function deleteSourceCandidate(id: string) {
  return prisma.sourceCandidate.delete({ where: { id } });
}
