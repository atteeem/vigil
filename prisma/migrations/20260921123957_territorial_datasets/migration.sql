-- CreateTable
CREATE TABLE "territorial_datasets" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "conflict_id" TEXT,
    "region_id" TEXT,
    "country_codes" TEXT,
    "dataset_type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "source_url" TEXT,
    "license" TEXT,
    "attribution" TEXT,
    "coverage_description" TEXT,
    "last_updated" DATETIME,
    "valid_from" DATETIME,
    "valid_to" DATETIME,
    "geometry_availability" TEXT NOT NULL DEFAULT 'none',
    "actor_coverage" TEXT,
    "confidence" REAL,
    "review_status" TEXT NOT NULL DEFAULT 'candidate',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "territorial_datasets_conflict_id_fkey" FOREIGN KEY ("conflict_id") REFERENCES "conflicts" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_conflict_territories" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "conflict_id" TEXT NOT NULL,
    "actor_id" TEXT,
    "status" TEXT NOT NULL,
    "confidence" REAL NOT NULL,
    "geometry" TEXT NOT NULL,
    "source_name" TEXT,
    "source_url" TEXT,
    "valid_from" DATETIME NOT NULL,
    "valid_to" DATETIME,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "split_from_id" TEXT,
    "territory_kind" TEXT NOT NULL DEFAULT 'control',
    "dataset_id" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "conflict_territories_conflict_id_fkey" FOREIGN KEY ("conflict_id") REFERENCES "conflicts" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "conflict_territories_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "conflict_actors" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "conflict_territories_dataset_id_fkey" FOREIGN KEY ("dataset_id") REFERENCES "territorial_datasets" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_conflict_territories" ("actor_id", "confidence", "conflict_id", "created_at", "geometry", "id", "published", "source_name", "source_url", "split_from_id", "status", "updated_at", "valid_from", "valid_to") SELECT "actor_id", "confidence", "conflict_id", "created_at", "geometry", "id", "published", "source_name", "source_url", "split_from_id", "status", "updated_at", "valid_from", "valid_to" FROM "conflict_territories";
DROP TABLE "conflict_territories";
ALTER TABLE "new_conflict_territories" RENAME TO "conflict_territories";
CREATE INDEX "conflict_territories_dataset_id_idx" ON "conflict_territories"("dataset_id");
CREATE INDEX "conflict_territories_conflict_id_valid_from_idx" ON "conflict_territories"("conflict_id", "valid_from");
CREATE INDEX "conflict_territories_published_valid_from_valid_to_idx" ON "conflict_territories"("published", "valid_from", "valid_to");
CREATE INDEX "conflict_territories_split_from_id_idx" ON "conflict_territories"("split_from_id");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "territorial_datasets_slug_key" ON "territorial_datasets"("slug");

-- CreateIndex
CREATE INDEX "territorial_datasets_conflict_id_idx" ON "territorial_datasets"("conflict_id");
