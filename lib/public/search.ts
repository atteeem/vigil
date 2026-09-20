import { prisma } from "@/lib/db/client";
import { COUNTRIES } from "@/lib/reference/countries";

export interface SearchResult {
  type: "country" | "conflict" | "event" | "actor";
  id: string;
  title: string;
  subtitle: string;
  href: string;
}

/** Public search over real data: reference countries, DB conflicts, published events and stored actors. */
export async function searchPublic(query: string, limit = 8): Promise<SearchResult[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const lower = q.toLowerCase();
  const results: SearchResult[] = [];

  for (const c of COUNTRIES) {
    if (c.name.toLowerCase().includes(lower) || c.code.toLowerCase() === lower) {
      results.push({ type: "country", id: c.code, title: c.name, subtitle: c.region, href: `/country/${c.code}` });
    }
  }
  const [conflicts, events, units] = await Promise.all([
    prisma.conflict.findMany({
      where: { status: { notIn: ["ended", "resolved", "archived"] }, OR: [{ name: { contains: q } }, { shortName: { contains: q } }] },
      select: { id: true, slug: true, name: true, shortName: true, region: true, severity: true },
      take: limit,
    }),
    prisma.event.findMany({ where: { published: true, title: { contains: q } }, select: { id: true, slug: true, title: true, region: true, occurredAt: true }, orderBy: { occurredAt: "desc" }, take: limit }),
    prisma.militaryUnit.findMany({ where: { name: { contains: q } }, select: { id: true, name: true, branch: true }, take: limit }),
  ]);
  for (const c of conflicts) {
    results.push({ type: "conflict", id: c.id, title: c.shortName ?? c.name, subtitle: `${c.region} · Severity: ${c.severity}`, href: `/conflict/${c.slug}` });
  }
  for (const u of units) {
    results.push({ type: "actor", id: u.id, title: u.name, subtitle: u.branch ?? "Armed actor", href: `/actor/${encodeURIComponent(u.id)}` });
  }
  for (const e of events) {
    results.push({ type: "event", id: e.id, title: e.title, subtitle: `${e.region ?? "Global"} · ${e.occurredAt.toISOString().slice(0, 10)}`, href: `/event/${e.slug}` });
  }
  return results.slice(0, limit);
}
