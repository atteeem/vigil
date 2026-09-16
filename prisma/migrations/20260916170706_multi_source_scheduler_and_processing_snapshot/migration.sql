-- AlterTable
ALTER TABLE "raw_ingestion_items" ADD COLUMN "location_source" TEXT;
ALTER TABLE "raw_ingestion_items" ADD COLUMN "processed_at" DATETIME;
ALTER TABLE "raw_ingestion_items" ADD COLUMN "suggested_conflict_id" TEXT;
ALTER TABLE "raw_ingestion_items" ADD COLUMN "suggested_country_code" TEXT;
ALTER TABLE "raw_ingestion_items" ADD COLUMN "suggested_event_type" TEXT;
ALTER TABLE "raw_ingestion_items" ADD COLUMN "suggested_importance" INTEGER;
ALTER TABLE "raw_ingestion_items" ADD COLUMN "suggested_lat" REAL;
ALTER TABLE "raw_ingestion_items" ADD COLUMN "suggested_lng" REAL;
ALTER TABLE "raw_ingestion_items" ADD COLUMN "suggested_location_name" TEXT;
ALTER TABLE "raw_ingestion_items" ADD COLUMN "suggested_region" TEXT;
ALTER TABLE "raw_ingestion_items" ADD COLUMN "suggested_severity" TEXT;

-- CreateTable
CREATE TABLE "ingestion_logs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "source_id" TEXT NOT NULL,
    "attempted_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fetched" INTEGER NOT NULL DEFAULT 0,
    "new_count" INTEGER NOT NULL DEFAULT 0,
    "already_known" INTEGER NOT NULL DEFAULT 0,
    "success" BOOLEAN NOT NULL DEFAULT true,
    "error_message" TEXT,
    CONSTRAINT "ingestion_logs_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "sources" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

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
    "source_role" TEXT,
    "permission_status" TEXT NOT NULL DEFAULT 'unauthorized',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "auto_ingest" BOOLEAN NOT NULL DEFAULT false,
    "auto_processing" BOOLEAN NOT NULL DEFAULT true,
    "poll_interval_minutes" INTEGER NOT NULL DEFAULT 5,
    "next_poll_at" DATETIME,
    "last_attempted_at" DATETIME,
    "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
    "last_successful_ingestion" DATETIME,
    "last_error" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);
INSERT INTO "new_sources" ("auto_ingest", "auto_processing", "country", "created_at", "enabled", "id", "language", "last_error", "last_successful_ingestion", "name", "permission_status", "region", "reliability_tier", "source_category", "telegram_handle", "type", "updated_at", "url") SELECT "auto_ingest", "auto_processing", "country", "created_at", "enabled", "id", "language", "last_error", "last_successful_ingestion", "name", "permission_status", "region", "reliability_tier", "source_category", "telegram_handle", "type", "updated_at", "url" FROM "sources";
DROP TABLE "sources";
ALTER TABLE "new_sources" RENAME TO "sources";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "ingestion_logs_source_id_attempted_at_idx" ON "ingestion_logs"("source_id", "attempted_at");
