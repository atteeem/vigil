-- AlterTable
ALTER TABLE "global_events" ADD COLUMN "country_code" TEXT;
ALTER TABLE "global_events" ADD COLUMN "entity_key" TEXT;
ALTER TABLE "global_events" ADD COLUMN "status" TEXT;

-- CreateTable
CREATE TABLE "global_event_links" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "global_event_id" TEXT NOT NULL,
    "conflict_id" TEXT,
    "event_id" TEXT,
    "basis" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'proposed',
    "note" TEXT,
    "source_name" TEXT,
    "source_url" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_at" DATETIME,
    CONSTRAINT "global_event_links_global_event_id_fkey" FOREIGN KEY ("global_event_id") REFERENCES "global_events" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "global_event_claims" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "global_event_id" TEXT,
    "entity_key" TEXT,
    "claimant" TEXT NOT NULL,
    "claim_type" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "source_name" TEXT,
    "source_url" TEXT,
    "observed_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verification" TEXT NOT NULL DEFAULT 'unverified',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "global_event_claims_global_event_id_fkey" FOREIGN KEY ("global_event_id") REFERENCES "global_events" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "global_event_links_global_event_id_idx" ON "global_event_links"("global_event_id");

-- CreateIndex
CREATE INDEX "global_event_links_conflict_id_idx" ON "global_event_links"("conflict_id");

-- CreateIndex
CREATE INDEX "global_event_claims_global_event_id_idx" ON "global_event_claims"("global_event_id");

-- CreateIndex
CREATE INDEX "global_events_layer_entity_key_idx" ON "global_events"("layer", "entity_key");
