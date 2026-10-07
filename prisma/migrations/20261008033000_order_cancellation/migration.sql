-- AlterTable (TASK-033, ADR-0039): when the order became CANCELLED; who and
-- why are in order_status_history and the audit log.
ALTER TABLE "orders" ADD COLUMN     "cancelled_at" TIMESTAMPTZ(3);
