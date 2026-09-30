-- AlterTable
ALTER TABLE "conflict_territories" ADD COLUMN "split_from_id" TEXT;

-- CreateIndex
CREATE INDEX "conflict_territories_split_from_id_idx" ON "conflict_territories"("split_from_id");
