-- CreateEnum
CREATE TYPE "cod_confirmation_source" AS ENUM ('WHATSAPP', 'PHONE');

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "cod_confirmation_deadline_at" TIMESTAMPTZ(3),
ADD COLUMN     "cod_confirmation_recorded_by_employee_id" UUID,
ADD COLUMN     "cod_confirmation_source" "cod_confirmation_source",
ADD COLUMN     "cod_confirmed_at" TIMESTAMPTZ(3),
ADD COLUMN     "cod_last_reminder_at" TIMESTAMPTZ(3),
ADD COLUMN     "cod_reminder_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "expired_at" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "cod_confirmation_tokens" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "channel" "cod_confirmation_source" NOT NULL DEFAULT 'WHATSAPP',
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "cod_confirmation_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cod_confirmation_tokens_token_hash_key" ON "cod_confirmation_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "cod_confirmation_tokens_order_id_idx" ON "cod_confirmation_tokens"("order_id");

-- CreateIndex
CREATE INDEX "orders_status_cod_confirmation_deadline_at_idx" ON "orders"("status", "cod_confirmation_deadline_at");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_cod_confirmation_recorded_by_employee_id_fkey" FOREIGN KEY ("cod_confirmation_recorded_by_employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cod_confirmation_tokens" ADD CONSTRAINT "cod_confirmation_tokens_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written (TASK-031, ADR-0037): a phone confirmation names the staff
-- member who recorded it (R10); reminder counts never go below zero.
ALTER TABLE "orders" ADD CONSTRAINT "orders_cod_phone_recorded_by_check"
  CHECK ("cod_confirmation_source" IS DISTINCT FROM 'PHONE'
         OR "cod_confirmation_recorded_by_employee_id" IS NOT NULL);
ALTER TABLE "orders" ADD CONSTRAINT "orders_cod_reminder_count_check"
  CHECK ("cod_reminder_count" >= 0);

-- Orders already waiting for confirmation get the default 72-hour deadline (R21, R39).
UPDATE "orders"
SET "cod_confirmation_deadline_at" = "created_at" + INTERVAL '72 hours'
WHERE "status" = 'PENDING_CONFIRMATION';
