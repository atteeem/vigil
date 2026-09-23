import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { getCoverage } from "@/lib/territory/datasets";
import { TERRITORIAL_DATASET_TYPES } from "@/lib/territory/dataset-types";

// Admin coverage view (per active conflict: control / presence data, pending review, stale, source candidates)
// and the dataset registry. Creating a registry entry never publishes geometry.
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await getCoverage());
}

interface Body {
  slug?: string;
  name?: string;
  conflictId?: string | null;
  regionId?: string | null;
  countryCodes?: string[];
  datasetType?: string;
  provider?: string;
  sourceUrl?: string | null;
  license?: string | null;
  attribution?: string | null;
  coverageDescription?: string | null;
  lastUpdated?: string | null;
  validFrom?: string | null;
  validTo?: string | null;
  geometryAvailability?: string;
  actorCoverage?: string[];
  confidence?: number | null;
  reviewStatus?: string;
  notes?: string | null;
}

export async function POST(request: Request) {
  const b = (await request.json()) as Body;
  if (!b.slug || !b.name || !b.provider || !b.datasetType) return NextResponse.json({ error: "slug, name, provider and datasetType are required" }, { status: 400 });
  if (!(TERRITORIAL_DATASET_TYPES as readonly string[]).includes(b.datasetType)) return NextResponse.json({ error: `datasetType must be one of ${TERRITORIAL_DATASET_TYPES.join(", ")}` }, { status: 400 });
  const date = (s?: string | null) => (s ? new Date(s) : null);
  const data = {
    name: b.name,
    conflictId: b.conflictId ?? null,
    regionId: b.regionId ?? null,
    countryCodes: b.countryCodes ? JSON.stringify(b.countryCodes) : null,
    datasetType: b.datasetType,
    provider: b.provider,
    sourceUrl: b.sourceUrl ?? null,
    license: b.license ?? null,
    attribution: b.attribution ?? null,
    coverageDescription: b.coverageDescription ?? null,
    lastUpdated: date(b.lastUpdated),
    validFrom: date(b.validFrom),
    validTo: date(b.validTo),
    geometryAvailability: b.geometryAvailability ?? "none",
    actorCoverage: b.actorCoverage ? JSON.stringify(b.actorCoverage) : null,
    confidence: b.confidence ?? null,
    reviewStatus: b.reviewStatus ?? "candidate",
    notes: b.notes ?? null,
  };
  const row = await prisma.territorialDataset.upsert({ where: { slug: b.slug }, create: { slug: b.slug, ...data }, update: data });
  return NextResponse.json(row, { status: 201 });
}
