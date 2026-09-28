-- AlterTable
ALTER TABLE "raw_ingestion_items" ADD COLUMN "suggested_classification" TEXT;
ALTER TABLE "raw_ingestion_items" ADD COLUMN "suggested_conflict_confidence" REAL;
ALTER TABLE "raw_ingestion_items" ADD COLUMN "suggested_conflict_reasons" TEXT;
ALTER TABLE "raw_ingestion_items" ADD COLUMN "suggested_readiness" TEXT;
ALTER TABLE "raw_ingestion_items" ADD COLUMN "suggested_readiness_reasons" TEXT;

-- CreateIndex
CREATE INDEX "raw_ingestion_items_processing_status_suggested_readiness_suggested_classification_idx" ON "raw_ingestion_items"("processing_status", "suggested_readiness", "suggested_classification");
