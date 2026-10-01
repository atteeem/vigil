-- AlterTable
ALTER TABLE "article_military_commander_links" ADD COLUMN "confidence" REAL;
ALTER TABLE "article_military_commander_links" ADD COLUMN "matched_text" TEXT;
ALTER TABLE "article_military_commander_links" ADD COLUMN "method" TEXT;

-- AlterTable
ALTER TABLE "article_military_equipment_links" ADD COLUMN "confidence" REAL;
ALTER TABLE "article_military_equipment_links" ADD COLUMN "matched_text" TEXT;
ALTER TABLE "article_military_equipment_links" ADD COLUMN "method" TEXT;

-- AlterTable
ALTER TABLE "article_military_unit_links" ADD COLUMN "confidence" REAL;
ALTER TABLE "article_military_unit_links" ADD COLUMN "matched_text" TEXT;
ALTER TABLE "article_military_unit_links" ADD COLUMN "method" TEXT;

-- AlterTable
ALTER TABLE "commander_appointments" ADD COLUMN "confidence" REAL;
ALTER TABLE "commander_appointments" ADD COLUMN "last_confirmed_at" DATETIME;
ALTER TABLE "commander_appointments" ADD COLUMN "observed_at" DATETIME;

-- AlterTable
ALTER TABLE "conflict_participants" ADD COLUMN "confidence" REAL;
ALTER TABLE "conflict_participants" ADD COLUMN "observed_at" DATETIME;
ALTER TABLE "conflict_participants" ADD COLUMN "source_name" TEXT;
ALTER TABLE "conflict_participants" ADD COLUMN "source_url" TEXT;
ALTER TABLE "conflict_participants" ADD COLUMN "valid_from" DATETIME;
ALTER TABLE "conflict_participants" ADD COLUMN "valid_to" DATETIME;

-- AlterTable
ALTER TABLE "military_unit_equipment" ADD COLUMN "confidence" REAL;
ALTER TABLE "military_unit_equipment" ADD COLUMN "observed_at" DATETIME;
ALTER TABLE "military_unit_equipment" ADD COLUMN "valid_from" DATETIME;
ALTER TABLE "military_unit_equipment" ADD COLUMN "valid_to" DATETIME;

-- AlterTable
ALTER TABLE "military_units" ADD COLUMN "country" TEXT;
ALTER TABLE "military_units" ADD COLUMN "entity_type" TEXT;
ALTER TABLE "military_units" ADD COLUMN "native_name" TEXT;

-- CreateTable
CREATE TABLE "entity_aliases" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "entity_kind" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "alias" TEXT NOT NULL,
    "normalized" TEXT NOT NULL,
    "alias_type" TEXT NOT NULL DEFAULT 'alternate',
    "source_scope" TEXT,
    "country_scope" TEXT,
    "source_name" TEXT,
    "source_url" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "unit_parent_history" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "unit_id" TEXT NOT NULL,
    "parent_unit_id" TEXT,
    "valid_from" DATETIME,
    "valid_to" DATETIME,
    "source_name" TEXT,
    "source_url" TEXT,
    "observed_at" DATETIME,
    "confidence" REAL,
    "note" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "unit_parent_history_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "military_units" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "unit_parent_history_parent_unit_id_fkey" FOREIGN KEY ("parent_unit_id") REFERENCES "military_units" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "actor_relationships" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "from_id" TEXT NOT NULL,
    "to_id" TEXT NOT NULL,
    "relation_type" TEXT NOT NULL,
    "conflict_id" TEXT,
    "source_name" TEXT,
    "source_url" TEXT,
    "observed_at" DATETIME,
    "confidence" REAL,
    "valid_from" DATETIME,
    "valid_to" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "actor_relationships_from_id_fkey" FOREIGN KEY ("from_id") REFERENCES "military_units" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "actor_relationships_to_id_fkey" FOREIGN KEY ("to_id") REFERENCES "military_units" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "event_equipment_links" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "event_id" TEXT NOT NULL,
    "equipment_id" TEXT NOT NULL,
    "matched_text" TEXT,
    "confidence" REAL,
    "source_name" TEXT,
    "source_url" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "event_equipment_links_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "event_equipment_links_equipment_id_fkey" FOREIGN KEY ("equipment_id") REFERENCES "military_equipment" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "event_commander_links" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "event_id" TEXT NOT NULL,
    "commander_id" TEXT NOT NULL,
    "matched_text" TEXT,
    "confidence" REAL,
    "source_name" TEXT,
    "source_url" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "event_commander_links_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "event_commander_links_commander_id_fkey" FOREIGN KEY ("commander_id") REFERENCES "commanders" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "entity_match_reviews" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "raw_ingestion_item_id" TEXT NOT NULL,
    "entity_kind" TEXT NOT NULL,
    "matched_text" TEXT NOT NULL,
    "candidate_ids" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "resolved_entity_id" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" DATETIME,
    CONSTRAINT "entity_match_reviews_raw_ingestion_item_id_fkey" FOREIGN KEY ("raw_ingestion_item_id") REFERENCES "raw_ingestion_items" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "entity_aliases_entity_kind_normalized_idx" ON "entity_aliases"("entity_kind", "normalized");

-- CreateIndex
CREATE UNIQUE INDEX "entity_aliases_entity_kind_entity_id_normalized_key" ON "entity_aliases"("entity_kind", "entity_id", "normalized");

-- CreateIndex
CREATE INDEX "unit_parent_history_unit_id_idx" ON "unit_parent_history"("unit_id");

-- CreateIndex
CREATE INDEX "actor_relationships_to_id_idx" ON "actor_relationships"("to_id");

-- CreateIndex
CREATE UNIQUE INDEX "actor_relationships_from_id_to_id_relation_type_conflict_id_key" ON "actor_relationships"("from_id", "to_id", "relation_type", "conflict_id");

-- CreateIndex
CREATE UNIQUE INDEX "event_equipment_links_event_id_equipment_id_key" ON "event_equipment_links"("event_id", "equipment_id");

-- CreateIndex
CREATE UNIQUE INDEX "event_commander_links_event_id_commander_id_key" ON "event_commander_links"("event_id", "commander_id");

-- CreateIndex
CREATE INDEX "entity_match_reviews_status_idx" ON "entity_match_reviews"("status");

-- CreateIndex
CREATE UNIQUE INDEX "entity_match_reviews_raw_ingestion_item_id_entity_kind_matched_text_key" ON "entity_match_reviews"("raw_ingestion_item_id", "entity_kind", "matched_text");

-- CreateIndex
CREATE INDEX "military_units_entity_type_idx" ON "military_units"("entity_type");

-- CreateIndex
CREATE INDEX "military_units_country_idx" ON "military_units"("country");
