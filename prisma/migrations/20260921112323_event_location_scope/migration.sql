-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_events" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "origin" TEXT NOT NULL DEFAULT 'conflict_news',
    "location_name" TEXT,
    "latitude" REAL,
    "longitude" REAL,
    "country_code" TEXT,
    "region" TEXT,
    "location_scope" TEXT,
    "admin_region" TEXT,
    "city" TEXT,
    "location_evidence" TEXT,
    "conflict_id" TEXT,
    "occurred_at" DATETIME NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "severity" TEXT NOT NULL,
    "importance" INTEGER NOT NULL DEFAULT 50,
    "verification_status" TEXT NOT NULL DEFAULT 'unverified',
    "published" BOOLEAN NOT NULL DEFAULT false,
    "published_at" DATETIME,
    "actors" TEXT,
    "casualties_killed" INTEGER,
    "casualties_injured" INTEGER,
    "infrastructure_damage" TEXT,
    "location_precision" TEXT,
    CONSTRAINT "events_conflict_id_fkey" FOREIGN KEY ("conflict_id") REFERENCES "conflicts" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_events" ("actors", "casualties_injured", "casualties_killed", "conflict_id", "country_code", "created_at", "event_type", "id", "importance", "infrastructure_damage", "latitude", "location_name", "location_precision", "longitude", "occurred_at", "origin", "published", "published_at", "region", "severity", "slug", "summary", "title", "updated_at", "verification_status") SELECT "actors", "casualties_injured", "casualties_killed", "conflict_id", "country_code", "created_at", "event_type", "id", "importance", "infrastructure_damage", "latitude", "location_name", "location_precision", "longitude", "occurred_at", "origin", "published", "published_at", "region", "severity", "slug", "summary", "title", "updated_at", "verification_status" FROM "events";
DROP TABLE "events";
ALTER TABLE "new_events" RENAME TO "events";
CREATE UNIQUE INDEX "events_slug_key" ON "events"("slug");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
