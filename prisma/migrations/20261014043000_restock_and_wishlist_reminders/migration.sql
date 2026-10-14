-- TASK-043: restock Notify Me subscriptions (Q51, Q52, R12) and wishlist
-- purchase reminder state (R6).

-- CreateEnum
CREATE TYPE "wishlist_reminder_stop_reason" AS ENUM ('PURCHASED', 'UNAVAILABLE', 'NO_MARKETING_CONSENT', 'MAX_REMINDERS');

-- CreateEnum
CREATE TYPE "restock_subscription_status" AS ENUM ('ACTIVE', 'FULFILLED', 'CANCELLED');

-- AlterTable
ALTER TABLE "wishlist_items" ADD COLUMN     "last_reminded_at" TIMESTAMPTZ(3),
ADD COLUMN     "reminder_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "reminders_stopped_reason" "wishlist_reminder_stop_reason";

ALTER TABLE "wishlist_items" ADD CONSTRAINT "wishlist_items_reminder_count_check"
  CHECK ("reminder_count" >= 0);

-- CreateTable
CREATE TABLE "restock_subscriptions" (
    "id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "product_variant_id" UUID NOT NULL,
    "email_enabled" BOOLEAN NOT NULL,
    "whatsapp_enabled" BOOLEAN NOT NULL,
    "status" "restock_subscription_status" NOT NULL DEFAULT 'ACTIVE',
    "subscribed_at" TIMESTAMPTZ(3) NOT NULL,
    "fulfilled_at" TIMESTAMPTZ(3),
    "cancelled_at" TIMESTAMPTZ(3),

    CONSTRAINT "restock_subscriptions_pkey" PRIMARY KEY ("id"),
    -- At least one channel (User Flows §16.3: email, WhatsApp or both).
    CONSTRAINT "restock_subscriptions_channel_check" CHECK ("email_enabled" OR "whatsapp_enabled")
);

-- CreateIndex
CREATE INDEX "restock_subscriptions_status_product_variant_id_idx" ON "restock_subscriptions"("status", "product_variant_id");

-- CreateIndex: one active subscription per customer and variant.
CREATE UNIQUE INDEX "restock_subscriptions_one_active_key" ON "restock_subscriptions"("customer_id", "product_variant_id") WHERE status = 'ACTIVE';

-- AddForeignKey
ALTER TABLE "restock_subscriptions" ADD CONSTRAINT "restock_subscriptions_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restock_subscriptions" ADD CONSTRAINT "restock_subscriptions_product_variant_id_fkey" FOREIGN KEY ("product_variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
