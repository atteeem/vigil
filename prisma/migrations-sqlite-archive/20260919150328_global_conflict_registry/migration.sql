-- CreateTable
CREATE TABLE "conflict_families" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "conflict_participants" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "conflict_id" TEXT NOT NULL,
    "unit_id" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'belligerent',
    "note" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "conflict_participants_conflict_id_fkey" FOREIGN KEY ("conflict_id") REFERENCES "conflicts" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "conflict_participants_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "military_units" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "conflict_metadata_sources" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "conflict_id" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "source_name" TEXT NOT NULL,
    "source_url" TEXT,
    "note" TEXT,
    "retrieved_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "conflict_metadata_sources_conflict_id_fkey" FOREIGN KEY ("conflict_id") REFERENCES "conflicts" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "source_conflict_links" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "source_id" TEXT NOT NULL,
    "conflict_id" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'dedicated',
    "note" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "source_conflict_links_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "sources" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "source_conflict_links_conflict_id_fkey" FOREIGN KEY ("conflict_id") REFERENCES "conflicts" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "source_candidates" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "url" TEXT,
    "conflict_id" TEXT,
    "source_type" TEXT NOT NULL DEFAULT 'news',
    "language" TEXT,
    "status" TEXT NOT NULL DEFAULT 'candidate',
    "notes" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "source_candidates_conflict_id_fkey" FOREIGN KEY ("conflict_id") REFERENCES "conflicts" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_conflicts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "short_name" TEXT,
    "region" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "severity" TEXT NOT NULL,
    "intensity" INTEGER NOT NULL,
    "intensity_change_24h" INTEGER NOT NULL DEFAULT 0,
    "started_at" DATETIME,
    "lat" REAL,
    "lng" REAL,
    "primary_effects" TEXT,
    "countries" TEXT,
    "summary" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "ended_at" DATETIME,
    "full_scale_war" BOOLEAN NOT NULL DEFAULT false,
    "fighting_countries" TEXT,
    "participant_countries" TEXT,
    "supporter_countries" TEXT,
    "regions" TEXT,
    "geography_basis" TEXT NOT NULL DEFAULT 'admin',
    "classification_confidence" TEXT NOT NULL DEFAULT 'established',
    "classification_note" TEXT,
    "family_id" TEXT,
    "curated_at" DATETIME,
    CONSTRAINT "conflicts_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "conflict_families" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_conflicts" ("countries", "created_at", "id", "intensity", "intensity_change_24h", "lat", "lng", "name", "primary_effects", "region", "severity", "short_name", "slug", "started_at", "status", "summary", "updated_at") SELECT "countries", "created_at", "id", "intensity", "intensity_change_24h", "lat", "lng", "name", "primary_effects", "region", "severity", "short_name", "slug", "started_at", "status", "summary", "updated_at" FROM "conflicts";
DROP TABLE "conflicts";
ALTER TABLE "new_conflicts" RENAME TO "conflicts";
CREATE UNIQUE INDEX "conflicts_slug_key" ON "conflicts"("slug");
CREATE INDEX "conflicts_family_id_idx" ON "conflicts"("family_id");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "conflict_families_slug_key" ON "conflict_families"("slug");

-- CreateIndex
CREATE INDEX "conflict_participants_unit_id_idx" ON "conflict_participants"("unit_id");

-- CreateIndex
CREATE UNIQUE INDEX "conflict_participants_conflict_id_unit_id_key" ON "conflict_participants"("conflict_id", "unit_id");

-- CreateIndex
CREATE UNIQUE INDEX "conflict_metadata_sources_conflict_id_field_source_name_key" ON "conflict_metadata_sources"("conflict_id", "field", "source_name");

-- CreateIndex
CREATE INDEX "source_conflict_links_conflict_id_idx" ON "source_conflict_links"("conflict_id");

-- CreateIndex
CREATE UNIQUE INDEX "source_conflict_links_source_id_conflict_id_key" ON "source_conflict_links"("source_id", "conflict_id");

-- CreateIndex
CREATE INDEX "source_candidates_conflict_id_status_idx" ON "source_candidates"("conflict_id", "status");

-- Backfill: conflicts created before the registry only have the legacy
-- `countries` list. Treat it as their fighting geography so scoring keeps
-- working, but mark it "legacy_countries" so the coverage dashboard flags the
-- geography as unreviewed (the registry audit replaces it with curated data).
UPDATE "conflicts"
SET "fighting_countries" = "countries", "geography_basis" = 'legacy_countries'
WHERE "countries" IS NOT NULL AND "fighting_countries" IS NULL;
