-- CreateTable
CREATE TABLE "watchers" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "settings" TEXT NOT NULL DEFAULT '{}'
);

-- CreateTable
CREATE TABLE "watches" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "watcher_id" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'major',
    "rules" TEXT NOT NULL DEFAULT '{}',
    "muted" BOOLEAN NOT NULL DEFAULT false,
    "paused_until" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "watches_watcher_id_fkey" FOREIGN KEY ("watcher_id") REFERENCES "watchers" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "watcher_id" TEXT NOT NULL,
    "watch_id" TEXT,
    "fingerprint" TEXT NOT NULL,
    "alert_type" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "priority" TEXT NOT NULL,
    "priority_score" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_key" TEXT NOT NULL,
    "entity_label" TEXT NOT NULL,
    "event_id" TEXT,
    "global_event_id" TEXT,
    "conflict_slug" TEXT,
    "deep_link" TEXT NOT NULL,
    "snapshot" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "is_party_claim" BOOLEAN NOT NULL DEFAULT false,
    "is_resolution" BOOLEAN NOT NULL DEFAULT false,
    "suppressed_count" INTEGER NOT NULL DEFAULT 0,
    "quiet" BOOLEAN NOT NULL DEFAULT false,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "read_at" DATETIME,
    "dismissed_at" DATETIME,
    "archived_at" DATETIME,
    CONSTRAINT "notifications_watcher_id_fkey" FOREIGN KEY ("watcher_id") REFERENCES "watchers" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "alert_states" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "alert_type" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "value" REAL,
    "data" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_at" DATETIME NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "alert_records" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "signal_kind" TEXT NOT NULL,
    "signal_ref" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "alert_type" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_key" TEXT NOT NULL,
    "watch_id" TEXT,
    "watcher_id" TEXT,
    "decision" TEXT NOT NULL,
    "rule" TEXT,
    "priority" TEXT,
    "reason" TEXT,
    "notification_id" TEXT,
    "detail" TEXT
);

-- CreateIndex
CREATE INDEX "watches_entity_type_entity_key_idx" ON "watches"("entity_type", "entity_key");

-- CreateIndex
CREATE UNIQUE INDEX "watches_watcher_id_entity_type_entity_key_key" ON "watches"("watcher_id", "entity_type", "entity_key");

-- CreateIndex
CREATE INDEX "notifications_watcher_id_created_at_idx" ON "notifications"("watcher_id", "created_at");

-- CreateIndex
CREATE INDEX "notifications_watcher_id_read_at_idx" ON "notifications"("watcher_id", "read_at");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_watcher_id_fingerprint_key" ON "notifications"("watcher_id", "fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "alert_states_kind_key_alert_type_key" ON "alert_states"("kind", "key", "alert_type");

-- CreateIndex
CREATE INDEX "alert_records_created_at_idx" ON "alert_records"("created_at");

-- CreateIndex
CREATE INDEX "alert_records_fingerprint_idx" ON "alert_records"("fingerprint");
