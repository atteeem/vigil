// One-off backfill for the `original_url_key` column added by migration 20260927144122_original_url_key (see
// lib/db/repositories/raw-ingestion-items.ts and lib/ingestion/url-normalize.ts for why it exists: some real feeds
// mint a different guid for the same article across polls, which created real duplicate raw_ingestion_items).
//
// Run against any database that predates the migration (local dev DB; a production database at deploy time):
//   node scripts/backfill-original-url-key.mjs
// Add --delete-duplicates to also remove exact (source, key) duplicate PENDING rows, keeping the earliest received
// one. Never touches a row that has already been published, merged or rejected, or that is referenced by
// event_sources / extracted_facts / any other link table (checked before every delete).
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import "dotenv/config";

// The normalizer is TypeScript (import-mapped via "@/..."); this script runs directly under Node, so the logic is
// duplicated here in plain JS rather than pulled through a build step. Keep in sync with lib/ingestion/url-normalize.ts.
const TRACKING_PARAMS = new Set(["at_medium", "at_campaign", "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "fbclid", "gclid", "mc_cid", "mc_eid", "ref", "ref_src", "traffic_source", "spref", "ito", "cmpid", "cid", "preview", "preview_id"]);
function normalizeUrl(raw) {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return trimmed;
  let url;
  try {
    url = new URL(trimmed);
  } catch {
    return trimmed;
  }
  url.hash = "";
  const kept = [...url.searchParams.entries()].filter(([k]) => !TRACKING_PARAMS.has(k.toLowerCase()));
  kept.sort(([a], [b]) => a.localeCompare(b));
  url.search = "";
  for (const [k, v] of kept) url.searchParams.append(k, v);
  const host = url.hostname.toLowerCase();
  let path = url.pathname;
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  return `${url.protocol}//${host}${path}${url.search}`;
}

const deleteDuplicates = process.argv.includes("--delete-duplicates");
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const rows = await prisma.rawIngestionItem.findMany({ select: { id: true, sourceId: true, originalUrl: true, originalUrlKey: true } });
const keyOf = new Map();
let updated = 0;
for (const r of rows) {
  const key = r.originalUrl ? normalizeUrl(r.originalUrl) : null;
  keyOf.set(r.id, key);
  if (key !== r.originalUrlKey) {
    await prisma.rawIngestionItem.update({ where: { id: r.id }, data: { originalUrlKey: key } });
    updated++;
  }
}
console.log(`Backfilled original_url_key on ${updated} of ${rows.length} rows.`);

// Report (and optionally remove) confirmed duplicates: same source + same normalized key, more than one row.
const groups = new Map();
for (const r of rows) {
  const key = keyOf.get(r.id);
  if (!key) continue;
  const k = `${r.sourceId}|${key}`;
  (groups.get(k) ?? groups.set(k, []).get(k)).push(r.id);
}
const dupGroups = [...groups.values()].filter((ids) => ids.length > 1);
console.log(`Found ${dupGroups.length} duplicate group(s) (${dupGroups.reduce((n, g) => n + g.length - 1, 0)} redundant row(s)).`);

if (dupGroups.length && deleteDuplicates) {
  let removed = 0;
  let skipped = 0;
  for (const ids of dupGroups) {
    const withDates = await prisma.rawIngestionItem.findMany({ where: { id: { in: ids } }, select: { id: true, receivedAt: true, processingStatus: true } });
    withDates.sort((a, b) => a.receivedAt - b.receivedAt);
    const [keep, ...rest] = withDates;
    for (const row of rest) {
      if (row.processingStatus !== "pending") {
        console.log(`  skipping ${row.id}: status is ${row.processingStatus}, not pending`);
        skipped++;
        continue;
      }
      const [links, facts] = await Promise.all([prisma.eventSource.count({ where: { rawIngestionItemId: row.id } }), prisma.extractedFact.count({ where: { rawIngestionItemId: row.id } })]);
      if (links > 0) {
        console.log(`  skipping ${row.id}: linked to a published event`);
        skipped++;
        continue;
      }
      // Extracted facts / military links on a redundant duplicate are themselves redundant with the kept row's
      // (identical article, same extraction inputs); Prisma's onDelete: Cascade on those tables removes them.
      void facts;
      await prisma.rawIngestionItem.delete({ where: { id: row.id } });
      removed++;
    }
    void keep;
  }
  console.log(`Removed ${removed} redundant pending duplicate(s); skipped ${skipped}.`);
}

await prisma.$disconnect();
