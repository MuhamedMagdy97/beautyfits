-- AlterEnum
ALTER TYPE "shipment_event_type" ADD VALUE 'DELIVERY_FAILED';

-- CreateEnum
CREATE TYPE "contact_task_reason" AS ENUM ('DELIVERY_FAILED_THRESHOLD', 'OTHER');

-- CreateEnum
CREATE TYPE "contact_task_status" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CANCELLED');

-- AlterTable
ALTER TABLE "shipments" ADD COLUMN     "attempt_count" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "customer_contact_tasks" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "shipment_id" UUID,
    "reason" "contact_task_reason" NOT NULL,
    "status" "contact_task_status" NOT NULL DEFAULT 'OPEN',
    "assigned_employee_id" UUID,
    "outcome_notes" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "resolved_at" TIMESTAMPTZ(3),
    "resolved_by_employee_id" UUID,

    CONSTRAINT "customer_contact_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "customer_contact_tasks_status_created_at_idx" ON "customer_contact_tasks"("status", "created_at");

-- CreateIndex
CREATE INDEX "customer_contact_tasks_order_id_idx" ON "customer_contact_tasks"("order_id");

-- CreateIndex
CREATE INDEX "customer_contact_tasks_shipment_id_idx" ON "customer_contact_tasks"("shipment_id");

-- AddForeignKey
ALTER TABLE "customer_contact_tasks" ADD CONSTRAINT "customer_contact_tasks_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_contact_tasks" ADD CONSTRAINT "customer_contact_tasks_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "shipments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_contact_tasks" ADD CONSTRAINT "customer_contact_tasks_assigned_employee_id_fkey" FOREIGN KEY ("assigned_employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_contact_tasks" ADD CONSTRAINT "customer_contact_tasks_resolved_by_employee_id_fkey" FOREIGN KEY ("resolved_by_employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Hand-written (TASK-035, ADR-0047).

ALTER TABLE "shipments" ADD CONSTRAINT "shipments_attempt_count_check"
    CHECK ("attempt_count" >= 0);

-- A finished task records when and by whom; an open one does not.
ALTER TABLE "customer_contact_tasks" ADD CONSTRAINT "customer_contact_tasks_resolved_check"
    CHECK (("status" IN ('RESOLVED', 'CANCELLED')) = ("resolved_at" IS NOT NULL)
       AND ("resolved_by_employee_id" IS NULL OR "resolved_at" IS NOT NULL));
-- A failed-delivery task belongs to a shipment.
ALTER TABLE "customer_contact_tasks" ADD CONSTRAINT "customer_contact_tasks_shipment_check"
    CHECK ("reason" <> 'DELIVERY_FAILED_THRESHOLD' OR "shipment_id" IS NOT NULL);

-- At most one unfinished failed-delivery task per shipment.
CREATE UNIQUE INDEX "customer_contact_tasks_one_active_per_shipment"
    ON "customer_contact_tasks"("shipment_id")
    WHERE "reason" = 'DELIVERY_FAILED_THRESHOLD' AND "status" IN ('OPEN', 'IN_PROGRESS');

-- Contact tasks are part of the order's history: never deleted.
CREATE TRIGGER "customer_contact_tasks_no_delete"
BEFORE DELETE ON "customer_contact_tasks"
FOR EACH ROW EXECUTE FUNCTION "catalog_reject_delete"();
