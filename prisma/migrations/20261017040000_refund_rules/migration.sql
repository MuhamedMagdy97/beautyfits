-- CreateEnum
CREATE TYPE "return_responsibility" AS ENUM ('CUSTOMER', 'BEAUTYFITS', 'CARRIER', 'UNDETERMINED');

-- CreateEnum
CREATE TYPE "return_customer_caused_resolution" AS ENUM ('RETURN_TO_CUSTOMER', 'KEEP_PARTIAL_REFUND');

-- AlterTable
ALTER TABLE "return_items" ADD COLUMN     "customer_caused_resolution" "return_customer_caused_resolution",
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "resolution_basis_points" INTEGER,
ADD COLUMN     "resolved_at" TIMESTAMPTZ(3),
ADD COLUMN     "resolved_by_employee_id" UUID;

-- AlterTable
ALTER TABLE "returns" ADD COLUMN     "assessed_at" TIMESTAMPTZ(3),
ADD COLUMN     "assessed_by_employee_id" UUID,
ADD COLUMN     "assessment_notes" TEXT,
ADD COLUMN     "final_responsibility" "return_responsibility" NOT NULL DEFAULT 'UNDETERMINED',
ADD COLUMN     "return_shipping_fee" BIGINT;

-- AddForeignKey
ALTER TABLE "returns" ADD CONSTRAINT "returns_assessed_by_employee_id_fkey" FOREIGN KEY ("assessed_by_employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_items" ADD CONSTRAINT "return_items_resolved_by_employee_id_fkey" FOREIGN KEY ("resolved_by_employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written (TASK-040, ADR-0066).
-- The assessment (Q99) is recorded once: who, when and a decided
-- responsibility together; the pickup fee and notes only with it.
ALTER TABLE "returns" ADD CONSTRAINT "returns_assessment_check" CHECK (
  ("assessed_at" IS NULL) = ("assessed_by_employee_id" IS NULL)
  AND ("assessed_at" IS NULL) = ("final_responsibility" = 'UNDETERMINED')
  AND ("return_shipping_fee" IS NULL OR ("return_shipping_fee" >= 0 AND "assessed_at" IS NOT NULL))
  AND ("assessment_notes" IS NULL OR (btrim("assessment_notes") <> '' AND "assessed_at" IS NOT NULL))
);
-- The R7 decision (who, when, which) is set together; the kept-units rate
-- exactly for KEEP_PARTIAL_REFUND, as basis points (1–10000).
ALTER TABLE "return_items" ADD CONSTRAINT "return_items_resolution_check" CHECK (
  ("customer_caused_resolution" IS NULL) = ("resolved_at" IS NULL)
  AND ("resolved_at" IS NULL) = ("resolved_by_employee_id" IS NULL)
  AND (COALESCE("customer_caused_resolution" = 'KEEP_PARTIAL_REFUND', FALSE) = ("resolution_basis_points" IS NOT NULL))
  AND ("resolution_basis_points" IS NULL OR "resolution_basis_points" BETWEEN 1 AND 10000)
  AND ("notes" IS NULL OR (btrim("notes") <> '' AND "resolved_at" IS NOT NULL))
);
