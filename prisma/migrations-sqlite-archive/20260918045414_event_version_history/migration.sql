-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_event_sources" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "event_id" TEXT NOT NULL,
    "raw_ingestion_item_id" TEXT NOT NULL,
    "relationship" TEXT NOT NULL DEFAULT 'originating',
    "is_originating_source" BOOLEAN NOT NULL DEFAULT true,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "event_sources_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "event_sources_raw_ingestion_item_id_fkey" FOREIGN KEY ("raw_ingestion_item_id") REFERENCES "raw_ingestion_items" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_event_sources" ("event_id", "id", "is_originating_source", "raw_ingestion_item_id", "relationship") SELECT "event_id", "id", "is_originating_source", "raw_ingestion_item_id", "relationship" FROM "event_sources";
DROP TABLE "event_sources";
ALTER TABLE "new_event_sources" RENAME TO "event_sources";
CREATE UNIQUE INDEX "event_sources_event_id_raw_ingestion_item_id_key" ON "event_sources"("event_id", "raw_ingestion_item_id");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
