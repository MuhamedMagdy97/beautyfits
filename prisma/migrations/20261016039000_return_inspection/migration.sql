-- AlterEnum
ALTER TYPE "inventory_movement_type" ADD VALUE 'CUSTOMER_RETURN_RESTOCK';

-- AlterEnum
ALTER TYPE "media_purpose" ADD VALUE 'RETURN_INSPECTION';

-- CreateEnum
CREATE TYPE "return_item_condition" AS ENUM ('SELLABLE', 'DAMAGED', 'OPENED_USED', 'MISSING_PARTS', 'REJECTED');

-- CreateEnum
CREATE TYPE "return_inspection_result" AS ENUM ('RESTOCK', 'DAMAGED', 'REJECTED');

-- AlterTable
ALTER TABLE "returns" ADD COLUMN     "received_at" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "return_inspections" (
    "id" UUID NOT NULL,
    "return_item_id" UUID NOT NULL,
    "inspected_by_employee_id" UUID NOT NULL,
    "condition" "return_item_condition" NOT NULL,
    "result" "return_inspection_result" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "return_inspections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "return_inspection_evidence" (
    "id" UUID NOT NULL,
    "return_item_id" UUID NOT NULL,
    "media_asset_id" UUID NOT NULL,
    "uploaded_by_employee_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "return_inspection_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "return_inspections_return_item_id_idx" ON "return_inspections"("return_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "return_inspection_evidence_media_asset_id_key" ON "return_inspection_evidence"("media_asset_id");

-- CreateIndex
CREATE INDEX "return_inspection_evidence_return_item_id_idx" ON "return_inspection_evidence"("return_item_id");

-- AddForeignKey
ALTER TABLE "return_inspections" ADD CONSTRAINT "return_inspections_return_item_id_fkey" FOREIGN KEY ("return_item_id") REFERENCES "return_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_inspections" ADD CONSTRAINT "return_inspections_inspected_by_employee_id_fkey" FOREIGN KEY ("inspected_by_employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_inspection_evidence" ADD CONSTRAINT "return_inspection_evidence_return_item_id_fkey" FOREIGN KEY ("return_item_id") REFERENCES "return_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_inspection_evidence" ADD CONSTRAINT "return_inspection_evidence_media_asset_id_fkey" FOREIGN KEY ("media_asset_id") REFERENCES "media_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_inspection_evidence" ADD CONSTRAINT "return_inspection_evidence_uploaded_by_employee_id_fkey" FOREIGN KEY ("uploaded_by_employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written (TASK-039, ADR-0060).
-- A parcel is received only after its carrier pickup was arranged.
ALTER TABLE "returns" ADD CONSTRAINT "returns_received_check" CHECK (
  "received_at" IS NULL OR "pickup_requested_at" IS NOT NULL
);
-- Only units found sellable go back to stock (Q36).
ALTER TABLE "return_inspections" ADD CONSTRAINT "return_inspections_check" CHECK (
  "quantity" > 0
  AND ("result" <> 'RESTOCK' OR "condition" = 'SELLABLE')
  AND ("notes" IS NULL OR btrim("notes") <> '')
);

-- Inspection records are append-only.
CREATE TRIGGER "return_inspections_append_only"
BEFORE UPDATE OR DELETE ON "return_inspections"
FOR EACH ROW EXECUTE FUNCTION "returns_reject_change"();

CREATE TRIGGER "return_inspection_evidence_append_only"
BEFORE UPDATE OR DELETE ON "return_inspection_evidence"
FOR EACH ROW EXECUTE FUNCTION "returns_reject_change"();
