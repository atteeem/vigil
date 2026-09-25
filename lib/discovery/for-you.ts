import { prisma } from "@/lib/db/client";
import { getBrief } from "@/lib/brief/brief";
import type { BriefDevelopment } from "@/lib/brief/types";
import { listPublicConflicts } from "@/lib/public/conflicts";
import { computeImpact } from "@/lib/data/impact";
import { getCountryByCode } from "@/lib/reference/countries";

// "For You": the brief engine's meaningful developments (7 days, party claims excluded), kept ONLY when they relate to
// something the user explicitly chose — a watch, or their selected country — and each carrying the reason in words.
// There is no behavioural personalization: no clicks, no dwell time, no inferred interests.

export const FOR_YOU_IMPACT_MIN = 60;
const MAJOR_SIGNIFICANCE = 55;
const STATE_CHANGE_TYPES = new Set(["conflict_status", "escalation", "de_escalation", "territory_changed", "actor_involvement"]);

export interface ForYouItem {
  id: string;
  title: string;
  occurredAt: string;
  category: string;
  deepLink: string;
  conflictName: string | null;
  countryCode: string | null;
  significance: number;
  /** "Because you follow Finland", "Actor you follow: ...", "Major development affecting ... (watched)", ... */
  reasons: string[];
  /** Independently corroborated (2+ independent source groups). */
  corroborated: boolean;
  /** A state change (status, escalation, territory, new actor), not a single incident. */
  stateChange: boolean;
}

export interface ForYouFeed {
  items: ForYouItem[];
  watches: number;
  baseCountry: string | null;
}

export async function getForYouFeed(watcherId: string | null, baseCountry: string | null, now: Date = new Date()): Promise<ForYouFeed> {
  const [watches, brief, conflicts] = await Promise.all([watcherId ? prisma.watch.findMany({ where: { watcherId, muted: false } }) : Promise.resolve([]), getBrief({ window: "7d" }, now), listPublicConflicts()]);
  const base = baseCountry ? getCountryByCode(baseCountry) : undefined;
  const conflictBySlug = new Map(conflicts.map((c) => [c.slug, c]));
  const watchedCountries = watches.filter((w) => w.entityType === "country").map((w) => ({ code: w.entityKey.toUpperCase(), label: w.label }));
  const impactCache = new Map<string, number>();
  const impact = (slug: string, code: string): number => {
    const k = `${slug}|${code}`;
    if (!impactCache.has(k)) {
      const c = conflictBySlug.get(slug);
      const country = getCountryByCode(code);
      impactCache.set(k, c && country ? computeImpact(country, c).score : 0);
    }
    return impactCache.get(k)!;
  };

  const out: ForYouItem[] = [];
  for (const d of brief.developments as BriefDevelopment[]) {
    if (d.isPartyClaim) continue;
    const reasons: string[] = [];
    for (const w of watches) {
      if (!d.watchKeys.some((k) => k.type === w.entityType && k.key === w.entityKey)) continue;
      if (w.entityType === "actor" || w.entityType === "unit") reasons.push(`Actor you follow: ${w.label}`);
      else reasons.push(`Because you follow ${w.label}`);
    }
    // A major development in a conflict that strongly affects a watched country (central impact model).
    if (d.conflictSlug && d.significance >= MAJOR_SIGNIFICANCE) {
      for (const wc of watchedCountries) {
        if (reasons.some((r) => r.endsWith(wc.label))) continue;
        const i = impact(d.conflictSlug, wc.code);
        if (i >= FOR_YOU_IMPACT_MIN) reasons.push(`Major development affecting ${wc.label} (watched; impact ${i})`);
      }
    }
    if (base && !reasons.length) {
      const keyed = d.countryCode === base.code || d.watchKeys.some((k) => k.type === "country" && k.key === base.code);
      const i = d.conflictSlug ? impact(d.conflictSlug, base.code) : 0;
      if (keyed) reasons.push(`In ${base.name} (your country)`);
      else if (i >= FOR_YOU_IMPACT_MIN && d.significance >= MAJOR_SIGNIFICANCE) reasons.push(`Affects ${base.name} (your country; impact ${i})`);
    }
    if (!reasons.length) continue;
    out.push({ id: d.id, title: d.title, occurredAt: d.occurredAt, category: d.developmentType.replace(/_/g, " "), deepLink: d.deepLink, conflictName: d.conflictName, countryCode: d.countryCode, significance: d.significance, reasons: [...new Set(reasons)], corroborated: d.independentSourceCount >= 2, stateChange: STATE_CHANGE_TYPES.has(d.developmentType) });
  }
  // Watched items first, then state changes and corroborated updates, then significance and recency.
  const rank = (i: ForYouItem) => (i.reasons.some((r) => r.startsWith("Because you follow") || r.startsWith("Actor you follow")) ? 0 : 1);
  out.sort((a, b) => rank(a) - rank(b) || Number(b.stateChange) - Number(a.stateChange) || Number(b.corroborated) - Number(a.corroborated) || b.significance - a.significance || b.occurredAt.localeCompare(a.occurredAt));
  return { items: out.slice(0, 30), watches: watches.length, baseCountry: base?.code ?? null };
}
