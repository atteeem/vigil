-- AlterTable
ALTER TABLE "conflicts" ADD COLUMN "countries" TEXT;
ALTER TABLE "conflicts" ADD COLUMN "short_name" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_sources" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "url" TEXT,
    "telegram_handle" TEXT,
    "country" TEXT,
    "region" TEXT,
    "language" TEXT,
    "source_category" TEXT,
    "reliability_tier" TEXT,
    "permission_status" TEXT NOT NULL DEFAULT 'unauthorized',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "auto_ingest" BOOLEAN NOT NULL DEFAULT false,
    "auto_processing" BOOLEAN NOT NULL DEFAULT true,
    "last_successful_ingestion" DATETIME,
    "last_error" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);
INSERT INTO "new_sources" ("auto_ingest", "country", "created_at", "enabled", "id", "language", "last_error", "last_successful_ingestion", "name", "permission_status", "region", "reliability_tier", "source_category", "telegram_handle", "type", "updated_at", "url") SELECT "auto_ingest", "country", "created_at", "enabled", "id", "language", "last_error", "last_successful_ingestion", "name", "permission_status", "region", "reliability_tier", "source_category", "telegram_handle", "type", "updated_at", "url" FROM "sources";
DROP TABLE "sources";
ALTER TABLE "new_sources" RENAME TO "sources";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
