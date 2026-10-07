-- CreateEnum
CREATE TYPE "order_revision_status" AS ENUM ('PENDING_CONFIRMATION', 'CONFIRMED', 'SUPERSEDED', 'EXPIRED');

-- DropIndex
DROP INDEX "order_items_order_id_product_variant_id_key";

-- CreateTable
CREATE TABLE "order_revisions" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "revision_number" INTEGER NOT NULL,
    "requested_by_customer_id" UUID NOT NULL,
    "status" "order_revision_status" NOT NULL DEFAULT 'PENDING_CONFIRMATION',
    "old_total" BIGINT NOT NULL,
    "new_total" BIGINT NOT NULL,
    "request_json" JSONB NOT NULL,
    "previous_snapshot_json" JSONB NOT NULL,
    "proposed_snapshot_json" JSONB NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "confirmed_at" TIMESTAMPTZ(3),

    CONSTRAINT "order_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "order_revisions_order_id_revision_number_key" ON "order_revisions"("order_id", "revision_number");

-- CreateIndex
CREATE UNIQUE INDEX "order_items_order_id_product_variant_id_unit_price_key" ON "order_items"("order_id", "product_variant_id", "unit_price");

-- AddForeignKey
ALTER TABLE "order_revisions" ADD CONSTRAINT "order_revisions_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_revisions" ADD CONSTRAINT "order_revisions_requested_by_customer_id_fkey" FOREIGN KEY ("requested_by_customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Hand-written (TASK-032, ADR-0038).

-- At most one revision waits for confirmation per order.
CREATE UNIQUE INDEX "order_revisions_one_pending_key" ON "order_revisions"("order_id")
  WHERE "status" = 'PENDING_CONFIRMATION';

-- A confirmed revision (C5, R40) replaces the order's lines and commercial
-- columns. Only the revision transaction may do so: it sets the
-- transaction-local flag `beautyfits.order_revision`. The order's identity
-- (number, contact, payment method, currency, locale, creation) never
-- changes; the state before the revision is kept in `order_revisions`.
CREATE OR REPLACE FUNCTION "order_items_reject_change"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('beautyfits.order_revision', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'order_items rows are immutable (% rejected)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE OR REPLACE FUNCTION "orders_reject_change"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'orders are never deleted'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD."customer_id" IS NOT NULL AND NEW."customer_id" IS DISTINCT FROM OLD."customer_id" THEN
    RAISE EXCEPTION 'order snapshots are immutable'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF ROW(NEW."order_number", NEW."guest_email", NEW."guest_phone", NEW."payment_method",
         NEW."currency", NEW."locale", NEW."tax_included", NEW."customer_snapshot_json",
         NEW."created_at")
     IS DISTINCT FROM
     ROW(OLD."order_number", OLD."guest_email", OLD."guest_phone", OLD."payment_method",
         OLD."currency", OLD."locale", OLD."tax_included", OLD."customer_snapshot_json",
         OLD."created_at")
  THEN
    RAISE EXCEPTION 'order snapshots are immutable'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF current_setting('beautyfits.order_revision', true) IS DISTINCT FROM 'on'
     AND ROW(NEW."subtotal", NEW."discount_total", NEW."shipping_fee", NEW."total",
             NEW."wallet_amount_reserved", NEW."cod_amount", NEW."tax_amount", NEW."tax_rate",
             NEW."applied_discount_id", NEW."discount_snapshot_json",
             NEW."shipping_rule_snapshot_json", NEW."shipping_address_snapshot_json")
        IS DISTINCT FROM
        ROW(OLD."subtotal", OLD."discount_total", OLD."shipping_fee", OLD."total",
            OLD."wallet_amount_reserved", OLD."cod_amount", OLD."tax_amount", OLD."tax_rate",
            OLD."applied_discount_id", OLD."discount_snapshot_json",
            OLD."shipping_rule_snapshot_json", OLD."shipping_address_snapshot_json")
  THEN
    RAISE EXCEPTION 'order snapshots are immutable'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
