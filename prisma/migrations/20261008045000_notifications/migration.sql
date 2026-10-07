-- CreateEnum
CREATE TYPE "notification_recipient_type" AS ENUM ('CUSTOMER', 'EMPLOYEE');

-- CreateEnum
CREATE TYPE "notification_type" AS ENUM ('TRANSACTIONAL', 'MARKETING', 'RESTOCK');

-- CreateEnum
CREATE TYPE "notification_channel" AS ENUM ('EMAIL', 'WHATSAPP');

-- CreateEnum
CREATE TYPE "notification_delivery_status" AS ENUM ('PENDING', 'SENT', 'FAILED', 'FALLBACK_SENT');

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "recipient_type" "notification_recipient_type" NOT NULL,
    "customer_id" UUID,
    "employee_id" UUID,
    "type" "notification_type" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "deep_link_type" TEXT,
    "deep_link_id" UUID,
    "source_event_id" UUID,
    "read_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_deliveries" (
    "id" UUID NOT NULL,
    "notification_id" UUID,
    "source_event_id" UUID,
    "order_id" UUID,
    "template_key" TEXT NOT NULL,
    "locale" "locale" NOT NULL,
    "channel" "notification_channel" NOT NULL,
    "recipient" TEXT NOT NULL,
    "attempt_number" INTEGER NOT NULL,
    "status" "notification_delivery_status" NOT NULL,
    "provider_reference" TEXT,
    "failure_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "sent_at" TIMESTAMPTZ(3),

    CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "notifications_source_event_id_key" ON "notifications"("source_event_id");

-- CreateIndex
CREATE INDEX "notifications_customer_id_read_at_created_at_idx" ON "notifications"("customer_id", "read_at", "created_at" DESC);

-- CreateIndex
CREATE INDEX "notifications_employee_id_read_at_created_at_idx" ON "notifications"("employee_id", "read_at", "created_at" DESC);

-- CreateIndex
CREATE INDEX "notification_deliveries_status_created_at_idx" ON "notification_deliveries"("status", "created_at");

-- CreateIndex
CREATE INDEX "notification_deliveries_order_id_idx" ON "notification_deliveries"("order_id");

-- CreateIndex
CREATE INDEX "notification_deliveries_notification_id_idx" ON "notification_deliveries"("notification_id");

-- CreateIndex
CREATE UNIQUE INDEX "notification_deliveries_source_event_id_attempt_number_key" ON "notification_deliveries"("source_event_id", "attempt_number");

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_notification_id_fkey" FOREIGN KEY ("notification_id") REFERENCES "notifications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written (TASK-045, ADR-0043): a notification belongs to exactly the
-- recipient its type names; attempts are numbered from 1; a sent attempt has
-- its send time.
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_check"
  CHECK (("recipient_type" = 'CUSTOMER' AND "customer_id" IS NOT NULL AND "employee_id" IS NULL)
      OR ("recipient_type" = 'EMPLOYEE' AND "employee_id" IS NOT NULL AND "customer_id" IS NULL));
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_attempt_number_check"
  CHECK ("attempt_number" >= 1);
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_sent_at_check"
  CHECK ("status" NOT IN ('SENT', 'FALLBACK_SENT') OR "sent_at" IS NOT NULL);
