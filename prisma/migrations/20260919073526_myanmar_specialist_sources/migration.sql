-- AlterTable
ALTER TABLE "events" ADD COLUMN "location_precision" TEXT;

-- CreateTable
CREATE TABLE "military_unit_events" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "unit_id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "source_name" TEXT,
    "source_url" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "military_unit_events_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "military_units" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "military_unit_events_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "areas_of_operation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "unit_id" TEXT NOT NULL,
    "conflict_id" TEXT,
    "name" TEXT,
    "description" TEXT,
    "geometry" TEXT NOT NULL,
    "precision" TEXT NOT NULL DEFAULT 'unknown',
    "as_of_date" DATETIME,
    "source_name" TEXT,
    "source_url" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "areas_of_operation_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "military_units" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "areas_of_operation_conflict_id_fkey" FOREIGN KEY ("conflict_id") REFERENCES "conflicts" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "territorial_change_candidates" (
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
    CONSTRAINT "territorial_change_candidates_conflict_id_fkey" FOREIGN KEY ("conflict_id") REFERENCES "conflicts" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "territorial_change_candidates_claimed_actor_id_fkey" FOREIGN KEY ("claimed_actor_id") REFERENCES "military_units" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "territorial_change_candidates_previous_actor_id_fkey" FOREIGN KEY ("previous_actor_id") REFERENCES "military_units" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "military_unit_events_unit_id_event_id_key" ON "military_unit_events"("unit_id", "event_id");

-- CreateIndex
CREATE INDEX "areas_of_operation_unit_id_idx" ON "areas_of_operation"("unit_id");

-- CreateIndex
CREATE INDEX "areas_of_operation_conflict_id_idx" ON "areas_of_operation"("conflict_id");

-- CreateIndex
CREATE INDEX "territorial_change_candidates_conflict_id_status_idx" ON "territorial_change_candidates"("conflict_id", "status");
