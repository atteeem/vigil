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
    "canonical_source_url" TEXT,
    "feed_url" TEXT,
    "social_profile_url" TEXT,
    "platform" TEXT,
    "platform_handle" TEXT,
    "verification_status" TEXT NOT NULL DEFAULT 'needs_verification',
    "verified_at" DATETIME,
    "verification_notes" TEXT,
    "independence_class" TEXT,
    "claim_policy" TEXT,
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
INSERT INTO "new_sources" ("auto_ingest", "auto_processing", "consecutive_failures", "country", "created_at", "enabled", "id", "language", "last_attempted_at", "last_error", "last_successful_ingestion", "name", "next_poll_at", "permission_status", "poll_interval_minutes", "region", "reliability_tier", "source_category", "source_role", "telegram_handle", "type", "updated_at", "url") SELECT "auto_ingest", "auto_processing", "consecutive_failures", "country", "created_at", "enabled", "id", "language", "last_attempted_at", "last_error", "last_successful_ingestion", "name", "next_poll_at", "permission_status", "poll_interval_minutes", "region", "reliability_tier", "source_category", "source_role", "telegram_handle", "type", "updated_at", "url" FROM "sources";
DROP TABLE "sources";
ALTER TABLE "new_sources" RENAME TO "sources";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- Backfill identity fields from what the rows already say (no guessing):
UPDATE "sources" SET "feed_url" = "url" WHERE "type" = 'rss' AND "url" IS NOT NULL;
UPDATE "sources" SET "platform" = "type";
UPDATE "sources" SET "platform_handle" = REPLACE("telegram_handle", '@', '') WHERE "telegram_handle" IS NOT NULL;
UPDATE "sources" SET "social_profile_url" = 'https://t.me/' || REPLACE("telegram_handle", '@', '') WHERE "type" = 'telegram' AND "telegram_handle" IS NOT NULL;
-- Existing enabled RSS/manual sources were already fetched or entered by an admin.
UPDATE "sources" SET "verification_status" = 'verified', "verification_notes" = 'Backfilled: existing enabled source predating verification tracking.' WHERE "enabled" = 1 AND "type" IN ('rss', 'manual');
