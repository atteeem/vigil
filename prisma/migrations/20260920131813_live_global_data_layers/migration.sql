-- CreateTable
CREATE TABLE "global_events" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "origin" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "layer" TEXT NOT NULL,
    "subtype" TEXT,
    "provider" TEXT NOT NULL,
    "provider_event_id" TEXT NOT NULL,
    "source_id" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "severity_domain" TEXT,
    "severity_value" REAL,
    "severity_label" TEXT,
    "prominence" REAL NOT NULL DEFAULT 0,
    "confidence_label" TEXT,
    "confidence_value" REAL,
    "geometry_type" TEXT NOT NULL DEFAULT 'point',
    "geometry" TEXT,
    "lat" REAL NOT NULL,
    "lng" REAL NOT NULL,
    "min_lat" REAL NOT NULL,
    "max_lat" REAL NOT NULL,
    "min_lng" REAL NOT NULL,
    "max_lng" REAL NOT NULL,
    "location_precision" TEXT NOT NULL DEFAULT 'exact',
    "observed_at" DATETIME NOT NULL,
    "provider_updated_at" DATETIME,
    "effective_at" DATETIME,
    "expires_at" DATETIME,
    "ended_at" DATETIME,
    "source_url" TEXT,
    "metadata" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "content_hash" TEXT NOT NULL,
    "first_seen_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "global_events_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "sources" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "global_event_revisions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "global_event_id" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "provider_updated_at" DATETIME,
    "recorded_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "snapshot" TEXT NOT NULL,
    CONSTRAINT "global_event_revisions_global_event_id_fkey" FOREIGN KEY ("global_event_id") REFERENCES "global_events" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "global_event_aggregates" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "provider" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "cell_lat" REAL NOT NULL,
    "cell_lng" REAL NOT NULL,
    "count" INTEGER NOT NULL,
    "max_intensity" REAL,
    "sum_intensity" REAL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "hazard_zones" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "geometry" TEXT NOT NULL,
    "fetched_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

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
    "latitude" REAL NOT NULL,
    "longitude" REAL NOT NULL,
    "country_code" TEXT,
    "region" TEXT,
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
INSERT INTO "new_events" ("actors", "casualties_injured", "casualties_killed", "conflict_id", "country_code", "created_at", "event_type", "id", "importance", "infrastructure_damage", "latitude", "location_name", "location_precision", "longitude", "occurred_at", "published", "published_at", "region", "severity", "slug", "summary", "title", "updated_at", "verification_status") SELECT "actors", "casualties_injured", "casualties_killed", "conflict_id", "country_code", "created_at", "event_type", "id", "importance", "infrastructure_damage", "latitude", "location_name", "location_precision", "longitude", "occurred_at", "published", "published_at", "region", "severity", "slug", "summary", "title", "updated_at", "verification_status" FROM "events";
DROP TABLE "events";
ALTER TABLE "new_events" RENAME TO "events";
CREATE UNIQUE INDEX "events_slug_key" ON "events"("slug");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "global_events_layer_observed_at_idx" ON "global_events"("layer", "observed_at");

-- CreateIndex
CREATE INDEX "global_events_category_observed_at_idx" ON "global_events"("category", "observed_at");

-- CreateIndex
CREATE INDEX "global_events_layer_min_lat_max_lat_min_lng_max_lng_idx" ON "global_events"("layer", "min_lat", "max_lat", "min_lng", "max_lng");

-- CreateIndex
CREATE INDEX "global_events_expires_at_idx" ON "global_events"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "global_events_provider_provider_event_id_key" ON "global_events"("provider", "provider_event_id");

-- CreateIndex
CREATE UNIQUE INDEX "global_event_revisions_global_event_id_revision_key" ON "global_event_revisions"("global_event_id", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "global_event_aggregates_provider_category_day_cell_lat_cell_lng_key" ON "global_event_aggregates"("provider", "category", "day", "cell_lat", "cell_lng");
