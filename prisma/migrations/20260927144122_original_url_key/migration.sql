-- AlterTable
ALTER TABLE "raw_ingestion_items" ADD COLUMN "original_url_key" TEXT;

-- CreateIndex
CREATE INDEX "raw_ingestion_items_source_id_original_url_key_idx" ON "raw_ingestion_items"("source_id", "original_url_key");
