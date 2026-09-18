-- CreateTable
CREATE TABLE "conflict_actors" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "conflict_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "conflict_actors_conflict_id_fkey" FOREIGN KEY ("conflict_id") REFERENCES "conflicts" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "conflict_territories" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "conflict_id" TEXT NOT NULL,
    "actor_id" TEXT,
    "status" TEXT NOT NULL,
    "confidence" REAL NOT NULL,
    "geometry" TEXT NOT NULL,
    "source_name" TEXT,
    "source_url" TEXT,
    "valid_from" DATETIME NOT NULL,
    "valid_to" DATETIME,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "conflict_territories_conflict_id_fkey" FOREIGN KEY ("conflict_id") REFERENCES "conflicts" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "conflict_territories_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "conflict_actors" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "conflict_actors_conflict_id_name_key" ON "conflict_actors"("conflict_id", "name");

-- CreateIndex
CREATE INDEX "conflict_territories_conflict_id_valid_from_idx" ON "conflict_territories"("conflict_id", "valid_from");

-- CreateIndex
CREATE INDEX "conflict_territories_published_valid_from_valid_to_idx" ON "conflict_territories"("published", "valid_from", "valid_to");
