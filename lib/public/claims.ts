import { prisma } from "@/lib/db/client";
import { parseCorroboration } from "@/lib/db/repositories/myanmar";
import { isNonIndependentRole } from "@/lib/registry/source-tiers";
import { resolveActorLinks, type ActorLink } from "./actors";

// Claims are not facts. A territorial claim ("Side A took X") is shown as a claim —
// with who makes it, where it came from and whether anything independent backs it.
// When two sides claim the same place, both claims are shown side by side and no
// conclusion is drawn while that is unresolved.

export interface PublicClaim {
  id: string;
  actor: ActorLink | null;
  changeType: string;
  description: string;
  status: "approved" | "uncertain";
  observedAt: string | null;
  sourceName: string | null;
  /** Original URL of the reporting item; null when none was stored (rendered "Source unavailable"). */
  sourceUrl: string | null;
  /** Reports beyond the first that are neither party claims nor aggregators. */
  independentCorroboration: number;
  /** True when the claim rests only on party/aggregator reports. */
  uncorroborated: boolean;
}

export interface ConflictingClaims {
  conflictSlug: string;
  location: string;
  claims: PublicClaim[];
}

const norm = (s: string | null) => (s ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** Location-level groups where at least two DIFFERENT actors each claim control. Only reviewed
 * (approved / uncertain) candidates are public; unreviewed leads never appear. */
export async function listConflictingClaims(conflictId: string): Promise<ConflictingClaims[]> {
  const rows = await prisma.territorialChangeCandidate.findMany({
    where: { conflictId, status: { in: ["approved", "uncertain"] }, claimedActorId: { not: null }, locationName: { not: null } },
    include: { conflict: { select: { slug: true } }, claimedActor: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  const byLocation = new Map<string, typeof rows>();
  for (const r of rows) {
    const key = norm(r.locationName);
    if (!key) continue;
    byLocation.set(key, [...(byLocation.get(key) ?? []), r]);
  }
  const groups: ConflictingClaims[] = [];
  for (const list of byLocation.values()) {
    const actors = new Set(list.map((r) => r.claimedActorId));
    if (actors.size < 2) continue;
    // One claim per actor (the most recent).
    const latest = new Map<string, (typeof rows)[number]>();
    for (const r of list) if (!latest.has(r.claimedActorId!)) latest.set(r.claimedActorId!, r);
    const links = new Map((await resolveActorLinks([...latest.values()].map((r) => r.claimedActor!.name))).map((l) => [l.name, l]));
    groups.push({
      conflictSlug: list[0]!.conflict.slug,
      location: list[0]!.locationName!,
      claims: [...latest.values()].map((r) => {
        const roles = [r.sourceRole, ...parseCorroboration(r.corroboration).map((c) => c.sourceRole ?? null)];
        const independent = roles.filter((role) => role !== null && !isNonIndependentRole(role)).length;
        return {
          id: r.id,
          actor: links.get(r.claimedActor!.name) ?? { name: r.claimedActor!.name, href: null },
          changeType: r.changeType,
          description: r.description,
          status: r.status as "approved" | "uncertain",
          observedAt: r.observedAt ? r.observedAt.toISOString() : null,
          sourceName: r.sourceName,
          sourceUrl: r.sourceUrl && r.sourceUrl.trim() ? r.sourceUrl : null,
          independentCorroboration: independent,
          uncorroborated: independent === 0,
        };
      }),
    });
  }
  return groups;
}
