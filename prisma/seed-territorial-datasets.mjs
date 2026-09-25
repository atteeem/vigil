// Seeds the territorial dataset registry (data/territorial-datasets.json) and loads imported geometry
// (data/territorial/*.json) as UNPUBLISHED draft ConflictTerritory versions. Idempotent:
//   - registry rows are upserted by slug, but a dataset a human has already approved keeps its review state;
//   - geometry is loaded only while a dataset has no territory rows at all, so re-seeding never duplicates drafts and
//     never touches published history.
// Publishing is always a human step (/admin/territorial-control -> coverage -> Publish).
import { readFileSync, existsSync } from "node:fs";

const ACTOR_COLOR_PALETTE = ["#e63946", "#2a9d8f", "#457b9d", "#f4a261", "#8338ec", "#ffb703", "#3a86ff", "#fb8500", "#06d6a0", "#c9184a"]; // lib/map/territorial-colors.ts
const KIND = { TERRITORIAL_CONTROL: "control", CONTESTED_CONTROL: "control", INFLUENCE: "influence", PRESENCE: "presence" };

async function actorFor(prisma, conflictId, name) {
  const existing = await prisma.conflictActor.findUnique({ where: { conflictId_name: { conflictId, name } } });
  if (existing) return existing;
  const count = await prisma.conflictActor.count({ where: { conflictId } });
  return prisma.conflictActor.create({ data: { conflictId, name, color: ACTOR_COLOR_PALETTE[count % ACTOR_COLOR_PALETTE.length] } });
}

export async function seedTerritorialDatasets(prisma) {
  const { datasets } = JSON.parse(readFileSync("data/territorial-datasets.json", "utf8"));
  let drafts = 0;
  for (const d of datasets) {
    const conflict = d.conflictSlug ? await prisma.conflict.findUnique({ where: { slug: d.conflictSlug }, select: { id: true } }) : null;
    const geometry = d.geometryFile && existsSync(d.geometryFile) ? JSON.parse(readFileSync(d.geometryFile, "utf8")) : null;
    const versions = geometry?.versions ?? [];
    const base = {
      name: d.name,
      conflictId: conflict?.id ?? null,
      regionId: d.regionId ?? null,
      countryCodes: JSON.stringify(d.countryCodes ?? []),
      datasetType: d.datasetType,
      provider: d.provider,
      sourceUrl: d.sourceUrl ?? null,
      license: d.license ?? null,
      attribution: d.attribution ?? null,
      coverageDescription: d.coverageDescription ?? null,
      actorCoverage: d.actorCoverage ? JSON.stringify(d.actorCoverage) : null,
      confidence: d.confidence ?? null,
      notes: d.notes ?? null,
      ...(versions.length ? { lastUpdated: new Date(versions.at(-1).validFrom), validFrom: new Date(versions[0].validFrom) } : {}),
    };
    const initialReview = versions.length ? "pending_review" : (d.reviewStatus ?? "candidate");
    const initialAvailability = versions.length ? "draft" : (d.geometryAvailability ?? "none");
    const existing = await prisma.territorialDataset.findUnique({ where: { slug: d.slug } });
    const row = existing
      ? await prisma.territorialDataset.update({
          where: { slug: d.slug },
          // A human decision (approved / rejected) is never overwritten by a re-seed.
          data: { ...base, ...(["approved", "rejected"].includes(existing.reviewStatus) ? {} : { reviewStatus: initialReview, geometryAvailability: initialAvailability }) },
        })
      : await prisma.territorialDataset.create({ data: { slug: d.slug, ...base, reviewStatus: initialReview, geometryAvailability: initialAvailability } });

    if (!versions.length || !conflict) continue;
    if ((await prisma.conflictTerritory.count({ where: { datasetId: row.id } })) > 0) continue;
    for (const [i, v] of versions.entries()) {
      const validTo = versions[i + 1] ? new Date(versions[i + 1].validFrom) : null;
      for (const a of v.actors) {
        const actor = await actorFor(prisma, conflict.id, a.name);
        await prisma.conflictTerritory.create({
          data: {
            conflictId: conflict.id,
            actorId: actor.id,
            status: "controlled",
            confidence: d.confidence ?? 0.6,
            geometry: JSON.stringify(a.geometry),
            sourceName: `${d.provider} — snapshot ${v.snapshot}`,
            sourceUrl: d.sourceUrl ?? null,
            validFrom: new Date(v.validFrom),
            validTo,
            published: false,
            territoryKind: KIND[d.datasetType] ?? "control",
            datasetId: row.id,
          },
        });
        drafts++;
      }
    }
  }
  console.log(`Seeded territorial dataset registry: ${datasets.length} entries, ${drafts} draft territory version(s) awaiting review.`);
}
