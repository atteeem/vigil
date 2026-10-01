-- CreateTable
CREATE TABLE "military_units" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "branch" TEXT,
    "unit_type" TEXT,
    "parent_unit_id" TEXT,
    "status" TEXT,
    "primary_conflict_id" TEXT,
    "source_name" TEXT,
    "source_url" TEXT,
    "last_updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "military_units_parent_unit_id_fkey" FOREIGN KEY ("parent_unit_id") REFERENCES "military_units" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "military_units_primary_conflict_id_fkey" FOREIGN KEY ("primary_conflict_id") REFERENCES "conflicts" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "military_equipment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "country_of_origin" TEXT,
    "source_name" TEXT,
    "source_url" TEXT,
    "last_updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "commanders" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "rank" TEXT,
    "current_unit_id" TEXT,
    "source_name" TEXT,
    "source_url" TEXT,
    "last_updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "commanders_current_unit_id_fkey" FOREIGN KEY ("current_unit_id") REFERENCES "military_units" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "commander_appointments" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "commander_id" TEXT NOT NULL,
    "unit_id" TEXT NOT NULL,
    "role" TEXT,
    "start_date" DATETIME,
    "end_date" DATETIME,
    "source_name" TEXT,
    "source_url" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "commander_appointments_commander_id_fkey" FOREIGN KEY ("commander_id") REFERENCES "commanders" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "commander_appointments_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "military_units" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "military_unit_equipment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "unit_id" TEXT NOT NULL,
    "equipment_id" TEXT NOT NULL,
    "source_name" TEXT,
    "source_url" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "military_unit_equipment_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "military_units" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "military_unit_equipment_equipment_id_fkey" FOREIGN KEY ("equipment_id") REFERENCES "military_equipment" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "article_military_unit_links" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "raw_ingestion_item_id" TEXT NOT NULL,
    "unit_id" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "article_military_unit_links_raw_ingestion_item_id_fkey" FOREIGN KEY ("raw_ingestion_item_id") REFERENCES "raw_ingestion_items" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "article_military_unit_links_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "military_units" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "article_military_equipment_links" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "raw_ingestion_item_id" TEXT NOT NULL,
    "equipment_id" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "article_military_equipment_links_raw_ingestion_item_id_fkey" FOREIGN KEY ("raw_ingestion_item_id") REFERENCES "raw_ingestion_items" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "article_military_equipment_links_equipment_id_fkey" FOREIGN KEY ("equipment_id") REFERENCES "military_equipment" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "article_military_commander_links" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "raw_ingestion_item_id" TEXT NOT NULL,
    "commander_id" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "article_military_commander_links_raw_ingestion_item_id_fkey" FOREIGN KEY ("raw_ingestion_item_id") REFERENCES "raw_ingestion_items" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "article_military_commander_links_commander_id_fkey" FOREIGN KEY ("commander_id") REFERENCES "commanders" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "military_units_name_key" ON "military_units"("name");

-- CreateIndex
CREATE UNIQUE INDEX "military_equipment_name_key" ON "military_equipment"("name");

-- CreateIndex
CREATE UNIQUE INDEX "commanders_name_key" ON "commanders"("name");

-- CreateIndex
CREATE INDEX "commander_appointments_commander_id_idx" ON "commander_appointments"("commander_id");

-- CreateIndex
CREATE INDEX "commander_appointments_unit_id_idx" ON "commander_appointments"("unit_id");

-- CreateIndex
CREATE UNIQUE INDEX "military_unit_equipment_unit_id_equipment_id_key" ON "military_unit_equipment"("unit_id", "equipment_id");

-- CreateIndex
CREATE UNIQUE INDEX "article_military_unit_links_raw_ingestion_item_id_unit_id_key" ON "article_military_unit_links"("raw_ingestion_item_id", "unit_id");

-- CreateIndex
CREATE UNIQUE INDEX "article_military_equipment_links_raw_ingestion_item_id_equipment_id_key" ON "article_military_equipment_links"("raw_ingestion_item_id", "equipment_id");

-- CreateIndex
CREATE UNIQUE INDEX "article_military_commander_links_raw_ingestion_item_id_commander_id_key" ON "article_military_commander_links"("raw_ingestion_item_id", "commander_id");
