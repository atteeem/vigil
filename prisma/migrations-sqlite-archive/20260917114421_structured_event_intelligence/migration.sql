-- CreateTable
CREATE TABLE "extracted_facts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "raw_ingestion_item_id" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "confidence" REAL NOT NULL,
    "source" TEXT NOT NULL,
    "observed_at" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'extracted',
    "original_value" TEXT,
    "extracted_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "extracted_facts_raw_ingestion_item_id_fkey" FOREIGN KEY ("raw_ingestion_item_id") REFERENCES "raw_ingestion_items" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "extracted_facts_raw_ingestion_item_id_field_idx" ON "extracted_facts"("raw_ingestion_item_id", "field");
