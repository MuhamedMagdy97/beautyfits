-- CreateEnum
CREATE TYPE "return_pickup_fee_payer" AS ENUM ('CUSTOMER', 'BEAUTYFITS');

-- AlterTable
ALTER TABLE "returns" ADD COLUMN     "approved_at" TIMESTAMPTZ(3),
ADD COLUMN     "approved_by_employee_id" UUID,
ADD COLUMN     "pickup_fee_payer" "return_pickup_fee_payer",
ADD COLUMN     "pickup_requested_at" TIMESTAMPTZ(3),
ADD COLUMN     "pickup_shipping_company_id" UUID,
ADD COLUMN     "pickup_tracking_number" TEXT,
ADD COLUMN     "rejected_at" TIMESTAMPTZ(3),
ADD COLUMN     "rejection_reason" TEXT;

-- CreateTable
CREATE TABLE "return_status_history" (
    "id" UUID NOT NULL,
    "return_id" UUID NOT NULL,
    "from_status" "return_status",
    "to_status" "return_status" NOT NULL,
    "changed_by_type" "audit_actor_type" NOT NULL,
    "changed_by_id" UUID,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "return_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "return_status_history_return_id_created_at_idx" ON "return_status_history"("return_id", "created_at");

-- AddForeignKey
ALTER TABLE "returns" ADD CONSTRAINT "returns_approved_by_employee_id_fkey" FOREIGN KEY ("approved_by_employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "returns" ADD CONSTRAINT "returns_pickup_shipping_company_id_fkey" FOREIGN KEY ("pickup_shipping_company_id") REFERENCES "shipping_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_status_history" ADD CONSTRAINT "return_status_history_return_id_fkey" FOREIGN KEY ("return_id") REFERENCES "returns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written (TASK-038, ADR-0056).
ALTER TABLE "returns" ADD CONSTRAINT "returns_approved_check" CHECK (("approved_at" IS NULL) = ("approved_by_employee_id" IS NULL));
ALTER TABLE "returns" ADD CONSTRAINT "returns_rejected_check" CHECK (
  (("status" = 'REJECTED') = ("rejected_at" IS NOT NULL))
  AND (("rejected_at" IS NULL) = ("rejection_reason" IS NULL))
  AND ("rejection_reason" IS NULL OR btrim("rejection_reason") <> '')
);
-- The pickup is arranged once, after approval, with its carrier and payer.
ALTER TABLE "returns" ADD CONSTRAINT "returns_pickup_check" CHECK (
  (("pickup_requested_at" IS NULL) = ("pickup_shipping_company_id" IS NULL))
  AND (("pickup_requested_at" IS NULL) = ("pickup_fee_payer" IS NULL))
  AND ("pickup_requested_at" IS NULL OR "approved_at" IS NOT NULL)
  AND ("pickup_tracking_number" IS NULL OR "pickup_requested_at" IS NOT NULL)
);

-- History of returns requested before this migration (TASK-037 made only
-- these two moves, both by the customer).
INSERT INTO "return_status_history" ("id", "return_id", "from_status", "to_status", "changed_by_type", "changed_by_id", "created_at")
SELECT gen_random_uuid(), "id", NULL, 'PENDING_APPROVAL', 'CUSTOMER', "customer_id", "created_at" FROM "returns";
INSERT INTO "return_status_history" ("id", "return_id", "from_status", "to_status", "changed_by_type", "changed_by_id", "created_at")
SELECT gen_random_uuid(), "id", 'PENDING_APPROVAL', 'CANCELLED', 'CUSTOMER', "customer_id", "cancelled_at" FROM "returns" WHERE "status" = 'CANCELLED';

-- Status history is append-only.
CREATE TRIGGER "return_status_history_append_only"
BEFORE UPDATE OR DELETE ON "return_status_history"
FOR EACH ROW EXECUTE FUNCTION "returns_reject_change"();
