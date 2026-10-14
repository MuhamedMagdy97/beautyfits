-- AlterEnum
ALTER TYPE "shipment_event_type" ADD VALUE 'SHIPPING_CANCELLATION_REQUESTED';
ALTER TYPE "shipment_event_type" ADD VALUE 'RETURN_TO_SENDER';
ALTER TYPE "shipment_event_type" ADD VALUE 'RETURNED';
ALTER TYPE "shipment_event_type" ADD VALUE 'RETURN_INSPECTED';

-- AlterEnum
ALTER TYPE "inventory_movement_type" ADD VALUE 'SHIPMENT_RETURN';

-- AlterEnum
ALTER TYPE "wallet_transaction_type" ADD VALUE 'ORDER_CANCELLATION_REFUND';

-- AlterTable
ALTER TABLE "shipments" ADD COLUMN     "cancellation_requested_at" TIMESTAMPTZ(3),
ADD COLUMN     "inspected_at" TIMESTAMPTZ(3),
ADD COLUMN     "returned_at" TIMESTAMPTZ(3);


-- Hand-written (TASK-036, ADR-0048).

-- A returned parcel has its return time, and only then; inspection follows the return.
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_returned_check"
    CHECK (("status" = 'RETURNED') = ("returned_at" IS NOT NULL));
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_inspected_check"
    CHECK ("inspected_at" IS NULL OR "returned_at" IS NOT NULL);
