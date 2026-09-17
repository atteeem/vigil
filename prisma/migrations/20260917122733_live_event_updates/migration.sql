-- AlterTable
ALTER TABLE "events" ADD COLUMN "actors" TEXT;
ALTER TABLE "events" ADD COLUMN "casualties_injured" INTEGER;
ALTER TABLE "events" ADD COLUMN "casualties_killed" INTEGER;
ALTER TABLE "events" ADD COLUMN "infrastructure_damage" TEXT;

-- CreateTable
CREATE TABLE "event_update_proposals" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "event_id" TEXT NOT NULL,
    "raw_ingestion_item_id" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "current_value" TEXT,
    "proposed_value" TEXT NOT NULL,
    "confidence" REAL NOT NULL,
    "source" TEXT NOT NULL,
    "observed_at" DATETIME NOT NULL,
    "change_type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" DATETIME,
    CONSTRAINT "event_update_proposals_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "event_update_proposals_raw_ingestion_item_id_fkey" FOREIGN KEY ("raw_ingestion_item_id") REFERENCES "raw_ingestion_items" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "event_history" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "event_id" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "old_value" TEXT,
    "new_value" TEXT NOT NULL,
    "raw_ingestion_item_id" TEXT,
    "source" TEXT NOT NULL,
    "automatic" BOOLEAN NOT NULL DEFAULT false,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "event_history_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "event_history_raw_ingestion_item_id_fkey" FOREIGN KEY ("raw_ingestion_item_id") REFERENCES "raw_ingestion_items" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "event_update_proposals_event_id_status_idx" ON "event_update_proposals"("event_id", "status");

-- CreateIndex
CREATE INDEX "event_history_event_id_created_at_idx" ON "event_history"("event_id", "created_at");
