-- CreateTable
CREATE TABLE "state_transitions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "alert_type" TEXT NOT NULL,
    "from_state" TEXT,
    "to_state" TEXT NOT NULL,
    "from_value" REAL,
    "to_value" REAL,
    "material" BOOLEAN NOT NULL DEFAULT false,
    "data" TEXT,
    "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "brief_snapshots" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scope_key" TEXT NOT NULL,
    "window_key" TEXT NOT NULL,
    "from_at" DATETIME NOT NULL,
    "to_at" DATETIME NOT NULL,
    "generated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revision" TEXT NOT NULL,
    "watcher_id" TEXT,
    "development_ids" TEXT NOT NULL,
    "summary" TEXT NOT NULL
);

-- CreateIndex
CREATE INDEX "state_transitions_at_idx" ON "state_transitions"("at");

-- CreateIndex
CREATE INDEX "state_transitions_kind_key_at_idx" ON "state_transitions"("kind", "key", "at");

-- CreateIndex
CREATE INDEX "brief_snapshots_scope_key_generated_at_idx" ON "brief_snapshots"("scope_key", "generated_at");
