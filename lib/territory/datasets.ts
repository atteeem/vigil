import { prisma } from "@/lib/db/client";
import { kindOfDatasetType, STALE_AFTER_DAYS, TERRITORIAL_DATASET_TYPES, type CoverageState, type PublicTerritorialDataset, type TerritorialDatasetType } from "@/lib/territory/dataset-types";

// The territorial dataset registry (which datasets exist, where they came from, under which licence) and what is
// AVAILABLE on the map. Availability is derived from PUBLISHED ConflictTerritory rows (versioned, immutable, human
// approved), never hard-coded: a registry entry with no published geometry (a candidate, a blocked source, a draft
// still awaiting review) is not offered to the public and is shown only in the admin coverage view.

const json = <T,>(s: string | null | undefined, fb: T): T => {
  try {
    return s ? (JSON.parse(s) as T) : fb;
  } catch {
    return fb;
  }
};
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

interface Bucket {
  count: number;
  dates: Date[];
  updated: Date[];
  actors: Set<string>;
  kinds: Set<string>;
  conflictId: string;
}

/** Published territory grouped by dataset id, or `conflict:<id>` for territory drawn without a registry dataset. */
async function publishedBuckets(): Promise<Map<string, Bucket>> {
  const rows = await prisma.conflictTerritory.findMany({ where: { published: true }, select: { datasetId: true, conflictId: true, validFrom: true, updatedAt: true, territoryKind: true, actor: { select: { name: true } } } });
  const out = new Map<string, Bucket>();
  for (const r of rows) {
    const key = r.datasetId ?? `conflict:${r.conflictId}`;
    const b = out.get(key) ?? { count: 0, dates: [], updated: [], actors: new Set<string>(), kinds: new Set<string>(), conflictId: r.conflictId };
    b.count++;
    b.dates.push(r.validFrom);
    b.updated.push(r.updatedAt);
    if (r.actor?.name) b.actors.add(r.actor.name);
    b.kinds.add(r.territoryKind);
    out.set(key, b);
  }
  return out;
}

const spanOf = (b: Bucket) => {
  const t = b.dates.map((d) => d.getTime());
  return { first: new Date(Math.min(...t)), distinctVersions: new Set(t).size };
};
const latest = (dates: Date[]) => new Date(Math.max(...dates.map((x) => x.getTime())));

/** Datasets with published geometry: what the Territorial Control selector lists. Metadata only, no geometry. */
export async function listAvailableDatasets(): Promise<PublicTerritorialDataset[]> {
  const [buckets, registry, conflicts] = await Promise.all([publishedBuckets(), prisma.territorialDataset.findMany({ where: { enabled: true } }), prisma.conflict.findMany({ select: { id: true, slug: true, name: true, fightingCountries: true } })]);
  const conflictById = new Map(conflicts.map((c) => [c.id, c]));
  const out: PublicTerritorialDataset[] = [];
  const seen = new Set<string>();

  for (const d of registry) {
    const b = buckets.get(d.id);
    if (!b) continue;
    seen.add(d.id);
    const c = d.conflictId ? conflictById.get(d.conflictId) : undefined;
    const { first, distinctVersions } = spanOf(b);
    const type = (TERRITORIAL_DATASET_TYPES as readonly string[]).includes(d.datasetType) ? (d.datasetType as TerritorialDatasetType) : "TERRITORIAL_CONTROL";
    out.push({
      id: d.id,
      name: d.name,
      conflictId: d.conflictId,
      conflictSlug: c?.slug ?? null,
      conflictName: c?.name ?? null,
      countryCodes: json<string[]>(d.countryCodes, []),
      datasetType: type,
      kind: kindOfDatasetType(type),
      provider: d.provider,
      sourceUrl: d.sourceUrl,
      license: d.license,
      attribution: d.attribution,
      coverageDescription: d.coverageDescription,
      lastUpdated: iso(d.lastUpdated ?? latest(b.updated)),
      validFrom: iso(first),
      validTo: d.validTo ? iso(d.validTo) : null,
      actors: [...b.actors].sort(),
      areaCount: b.count,
      versionCount: distinctVersions,
      confidence: d.confidence,
      reviewStatus: d.reviewStatus,
      hasHistory: distinctVersions > 1,
    });
  }

  // Territory drawn with the existing editor (no registry entry): an implicit, editorial, human-reviewed dataset per conflict.
  for (const [key, b] of buckets) {
    if (!key.startsWith("conflict:") || seen.has(key)) continue;
    const c = conflictById.get(b.conflictId);
    if (!c) continue;
    const { first, distinctVersions } = spanOf(b);
    const kind = b.kinds.has("control") ? "control" : b.kinds.has("influence") ? "influence" : "presence";
    out.push({
      id: key,
      name: c.name,
      conflictId: c.id,
      conflictSlug: c.slug,
      conflictName: c.name,
      countryCodes: json<string[]>(c.fightingCountries, []),
      datasetType: kind === "influence" ? "INFLUENCE" : kind === "presence" ? "PRESENCE" : "TERRITORIAL_CONTROL",
      kind,
      provider: "Vigil editorial (human-reviewed)",
      sourceUrl: null,
      license: null,
      attribution: null,
      coverageDescription: "Territory drawn and published by Vigil admins; each area keeps its own source.",
      lastUpdated: iso(latest(b.updated)),
      validFrom: iso(first),
      validTo: null,
      actors: [...b.actors].sort(),
      areaCount: b.count,
      versionCount: distinctVersions,
      confidence: null,
      reviewStatus: "approved",
      hasHistory: distinctVersions > 1,
    });
  }
  return out.sort((a, b) => (b.lastUpdated ?? "").localeCompare(a.lastUpdated ?? "") || a.name.localeCompare(b.name));
}

export interface CoverageDataset {
  id: string;
  slug: string | null;
  name: string;
  datasetType: string;
  provider: string;
  license: string | null;
  sourceUrl: string | null;
  reviewStatus: string;
  geometryAvailability: string;
  publishedVersions: number;
  draftVersions: number;
  lastUpdated: string | null;
  stale: boolean;
  notes: string | null;
}
export interface CoverageRow {
  conflictId: string;
  slug: string;
  name: string;
  status: string;
  state: CoverageState;
  datasets: CoverageDataset[];
}

/** Admin view: for every active conflict what territorial data Vigil has, is waiting to review, or knows a source for. */
export async function getCoverage(now: Date = new Date()): Promise<{ rows: CoverageRow[]; unlinked: CoverageDataset[] }> {
  const [conflicts, registry, territories] = await Promise.all([
    prisma.conflict.findMany({ where: { status: { in: ["active", "reduced"] } }, select: { id: true, slug: true, name: true, status: true }, orderBy: { name: "asc" } }),
    prisma.territorialDataset.findMany({ orderBy: { name: "asc" } }),
    prisma.conflictTerritory.findMany({ select: { conflictId: true, datasetId: true, published: true, updatedAt: true, territoryKind: true } }),
  ]);
  const staleBefore = now.getTime() - STALE_AFTER_DAYS * 86_400_000;
  const shape = (d: (typeof registry)[number]): CoverageDataset => {
    const t = territories.filter((x) => x.datasetId === d.id);
    const pub = t.filter((x) => x.published);
    const last = pub.length ? latest(pub.map((x) => x.updatedAt)) : d.lastUpdated;
    return { id: d.id, slug: d.slug, name: d.name, datasetType: d.datasetType, provider: d.provider, license: d.license, sourceUrl: d.sourceUrl, reviewStatus: d.reviewStatus, geometryAvailability: d.geometryAvailability, publishedVersions: pub.length, draftVersions: t.length - pub.length, lastUpdated: iso(last), stale: pub.length > 0 && !!last && last.getTime() < staleBefore, notes: d.notes };
  };
  const rows: CoverageRow[] = conflicts.map((c) => {
    const datasets = registry.filter((d) => d.conflictId === c.id).map(shape);
    const implicit = territories.filter((t) => t.datasetId === null && t.conflictId === c.id);
    const implicitPub = implicit.filter((t) => t.published);
    if (implicit.length) {
      const last = implicitPub.length ? latest(implicitPub.map((x) => x.updatedAt)) : null;
      datasets.push({ id: `conflict:${c.id}`, slug: null, name: `${c.name} (editorial)`, datasetType: implicit.some((t) => t.territoryKind === "control") ? "TERRITORIAL_CONTROL" : "INFLUENCE", provider: "Vigil editorial (human-reviewed)", license: null, sourceUrl: null, reviewStatus: implicitPub.length ? "approved" : "pending_review", geometryAvailability: implicitPub.length ? "published" : "draft", publishedVersions: implicitPub.length, draftVersions: implicit.length - implicitPub.length, lastUpdated: iso(last), stale: !!last && last.getTime() < staleBefore, notes: null });
    }
    const published = datasets.filter((d) => d.publishedVersions > 0);
    let state: CoverageState = "NO_DATA";
    if (published.length) {
      const fresh = published.filter((d) => !d.stale);
      state = fresh.length === 0 ? "STALE" : fresh.some((d) => d.datasetType === "TERRITORIAL_CONTROL" || d.datasetType === "CONTESTED_CONTROL") ? "HAS_CONTROL_DATA" : "HAS_PRESENCE_DATA";
    } else if (datasets.some((d) => d.draftVersions > 0)) state = "PENDING_REVIEW";
    else if (datasets.length) state = "SOURCE_CANDIDATE";
    return { conflictId: c.id, slug: c.slug, name: c.name, status: c.status, state, datasets };
  });
  return { rows, unlinked: registry.filter((d) => !d.conflictId).map(shape) };
}
