import { getPublicConflictDetail } from "@/lib/public/conflict-detail";
import { getBrief } from "@/lib/brief/brief";
import { scoreConflict } from "@/lib/db/repositories/scoring";
import { resolveCountry } from "@/lib/countries/registry";
import { toWorldItem } from "./derive";
import { conflictSeverityScore } from "./command-center";
import type { WorldItem } from "./types";

// Selected-conflict context for the World Command Center right rail. Severity, impact and confidence stay
// three separate numbers from the central scoring engine; the number of reports never feeds severity.

export interface ConflictContext {
  slug: string;
  name: string;
  status: string;
  statusLabel: string;
  severity: { label: string; score: number };
  confidence: { score: number; reasons: string[] };
  /** Impact for the requested country (registry hard rules apply), or null when no country was requested. */
  impact: { countryCode: string; countryName: string; score: number; hardFloor: string | null; reasons: string[] } | null;
  summary: string;
  latest: WorldItem[];
  territory: { areas: number; actors: { name: string; areas: number }[]; lastChangeAt: string | null } | null;
  participants: { name: string; role: string; href: string | null }[];
  corroboratedSources: number | null;
  lat: number | null;
  lng: number | null;
  href: string;
}

export async function getConflictContext(slug: string, country: string | null, now: Date = new Date()): Promise<ConflictContext | null> {
  const detail = await getPublicConflictDetail(slug, now);
  if (!detail) return null;
  const c = detail.conflict;
  const rec = country ? resolveCountry(country) : undefined;
  const [impactScores, brief] = await Promise.all([rec ? scoreConflict(c.id, rec.code) : Promise.resolve(null), getBrief({ window: "7d", conflict: slug }, now).catch(() => null)]);
  const impact = impactScores?.impact && rec ? { countryCode: rec.code, countryName: rec.name, score: impactScores.impact.impactScore, hardFloor: impactScores.impact.hardFloor, reasons: impactScores.impact.reasons.slice(0, 4) } : null;
  return {
    slug: c.slug,
    name: c.name,
    status: c.status,
    statusLabel: detail.statusLabel,
    severity: { label: c.severity, score: detail.scores?.severity.severityScore ?? conflictSeverityScore(c) },
    confidence: { score: detail.scores?.confidence.confidenceScore ?? 0, reasons: detail.scores?.confidence.reasons.slice(0, 3) ?? [] },
    impact,
    summary: c.summary,
    latest: (brief?.developments ?? []).filter((d) => !d.isPartyClaim).slice(0, 4).map(toWorldItem),
    territory: detail.territory.areas > 0 ? { areas: detail.territory.areas, actors: detail.territory.actors.slice(0, 4).map((a) => ({ name: a.name, areas: a.areas })), lastChangeAt: detail.territory.lastChangeAt } : null,
    participants: detail.actors.slice(0, 8).map((a) => ({ name: a.name, role: a.role, href: a.href })),
    corroboratedSources: detail.coverage?.independentSources ?? null,
    lat: c.locationKnown ? c.lat : null,
    lng: c.locationKnown ? c.lng : null,
    href: `/conflict/${c.slug}`,
  };
}
