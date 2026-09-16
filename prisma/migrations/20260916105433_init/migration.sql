-- CreateTable
CREATE TABLE "sources" (
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
    "last_successful_ingestion" DATETIME,
    "last_error" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "raw_ingestion_items" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "source_id" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "original_url" TEXT,
    "original_title" TEXT,
    "original_text" TEXT,
    "language" TEXT,
    "published_at" DATETIME,
    "received_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "media_urls" TEXT,
    "processing_status" TEXT NOT NULL DEFAULT 'pending',
    "raw_metadata" TEXT,
    CONSTRAINT "raw_ingestion_items_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "sources" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "conflicts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "severity" TEXT NOT NULL,
    "intensity" INTEGER NOT NULL,
    "intensity_change_24h" INTEGER NOT NULL DEFAULT 0,
    "started_at" DATETIME,
    "lat" REAL,
    "lng" REAL,
    "primary_effects" TEXT,
    "summary" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "events" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
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
    CONSTRAINT "events_conflict_id_fkey" FOREIGN KEY ("conflict_id") REFERENCES "conflicts" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "event_sources" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "event_id" TEXT NOT NULL,
    "raw_ingestion_item_id" TEXT NOT NULL,
    "relationship" TEXT NOT NULL DEFAULT 'originating',
    "is_originating_source" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "event_sources_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "event_sources_raw_ingestion_item_id_fkey" FOREIGN KEY ("raw_ingestion_item_id") REFERENCES "raw_ingestion_items" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "raw_ingestion_items_source_id_external_id_key" ON "raw_ingestion_items"("source_id", "external_id");

-- CreateIndex
CREATE UNIQUE INDEX "conflicts_slug_key" ON "conflicts"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "events_slug_key" ON "events"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "event_sources_event_id_raw_ingestion_item_id_key" ON "event_sources"("event_id", "raw_ingestion_item_id");
