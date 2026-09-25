import aliasData from "@/data/conflict-aliases.json";
import { prisma } from "@/lib/db/client";
import { normalizeName } from "@/lib/countries/registry";

// Resolves any reference to a conflict (database id, slug, canonical name, short name, curated alias) to the ONE
// canonical record. Aliases live in data/conflict-aliases.json keyed by registry slug.

export const CONFLICT_ALIASES: Record<string, string[]> = (aliasData as { aliases: Record<string, string[]> }).aliases;

const aliasIndex = new Map<string, string>();
for (const [slug, names] of Object.entries(CONFLICT_ALIASES)) for (const n of names) aliasIndex.set(normalizeName(n), slug);

/** Slug for a curated alias ("Ukraine war" -> "russia-ukraine"), or undefined. Pure. */
export const slugForAlias = (input: string): string | undefined => aliasIndex.get(normalizeName(input));

/** Slugs whose aliases contain the query (prefix / word match), for search. Pure. */
export function slugsMatchingAlias(query: string): { slug: string; alias: string }[] {
  const q = normalizeName(query);
  if (q.length < 3) return [];
  const out: { slug: string; alias: string }[] = [];
  for (const [slug, names] of Object.entries(CONFLICT_ALIASES)) {
    const hit = names.find((n) => {
      const nn = normalizeName(n);
      return nn === q || nn.startsWith(q) || nn.split(" ").some((w) => w.startsWith(q));
    });
    if (hit) out.push({ slug, alias: hit });
  }
  return out;
}

/** The canonical slug for an id / slug / name / alias, or null. */
export async function resolveConflictSlug(ref: string): Promise<string | null> {
  const raw = decodeURIComponent(ref).trim();
  if (!raw) return null;
  const direct = await prisma.conflict.findFirst({ where: { OR: [{ slug: raw }, { id: raw }] }, select: { slug: true } });
  if (direct) return direct.slug;
  const alias = slugForAlias(raw);
  if (alias && (await prisma.conflict.findUnique({ where: { slug: alias }, select: { slug: true } }))) return alias;
  const n = normalizeName(raw.replace(/-/g, " "));
  const all = await prisma.conflict.findMany({ select: { slug: true, name: true, shortName: true } });
  return all.find((c) => normalizeName(c.name) === n || (c.shortName && normalizeName(c.shortName) === n))?.slug ?? null;
}
