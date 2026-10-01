-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_territorial_change_candidates" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "conflict_id" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "claimed_actor_id" TEXT,
    "previous_actor_id" TEXT,
    "location_name" TEXT,
    "lat" REAL,
    "lng" REAL,
    "precision" TEXT NOT NULL DEFAULT 'unknown',
    "source_name" TEXT,
    "source_url" TEXT,
    "observed_at" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "review_note" TEXT,
    "reviewed_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "change_type" TEXT NOT NULL DEFAULT 'captured',
    "confidence" REAL NOT NULL DEFAULT 0.4,
    "evidence" TEXT,
    "claim_key" TEXT,
    "raw_ingestion_item_id" TEXT,
    "corroboration" TEXT,
    "merged_into_id" TEXT,
    "applied_territory_id" TEXT,
    "geometry_pending" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "territorial_change_candidates_conflict_id_fkey" FOREIGN KEY ("conflict_id") REFERENCES "conflicts" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "territorial_change_candidates_claimed_actor_id_fkey" FOREIGN KEY ("claimed_actor_id") REFERENCES "military_units" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "territorial_change_candidates_previous_actor_id_fkey" FOREIGN KEY ("previous_actor_id") REFERENCES "military_units" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_territorial_change_candidates" ("claimed_actor_id", "conflict_id", "created_at", "description", "id", "lat", "lng", "location_name", "observed_at", "precision", "previous_actor_id", "review_note", "reviewed_at", "source_name", "source_url", "status") SELECT "claimed_actor_id", "conflict_id", "created_at", "description", "id", "lat", "lng", "location_name", "observed_at", "precision", "previous_actor_id", "review_note", "reviewed_at", "source_name", "source_url", "status" FROM "territorial_change_candidates";
DROP TABLE "territorial_change_candidates";
ALTER TABLE "new_territorial_change_candidates" RENAME TO "territorial_change_candidates";
CREATE INDEX "territorial_change_candidates_conflict_id_status_idx" ON "territorial_change_candidates"("conflict_id", "status");
CREATE INDEX "territorial_change_candidates_claim_key_idx" ON "territorial_change_candidates"("claim_key");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
