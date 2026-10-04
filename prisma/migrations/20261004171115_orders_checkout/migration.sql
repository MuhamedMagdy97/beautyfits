-- CreateEnum
CREATE TYPE "order_status" AS ENUM ('PENDING_CONFIRMATION', 'NEW', 'CONFIRMED', 'PREPARING', 'READY_FOR_SHIPMENT', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "payment_method" AS ENUM ('COD');

-- CreateEnum
CREATE TYPE "checkout_attempt_status" AS ENUM ('STARTED', 'SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL,
    "order_number" TEXT NOT NULL,
    "customer_id" UUID,
    "guest_email" TEXT,
    "guest_phone" TEXT,
    "status" "order_status" NOT NULL,
    "payment_method" "payment_method" NOT NULL DEFAULT 'COD',
    "currency" CHAR(3) NOT NULL DEFAULT 'EGP',
    "locale" "locale" NOT NULL,
    "subtotal" BIGINT NOT NULL,
    "discount_total" BIGINT NOT NULL,
    "shipping_fee" BIGINT NOT NULL,
    "total" BIGINT NOT NULL,
    "wallet_amount_reserved" BIGINT NOT NULL,
    "wallet_amount_captured" BIGINT NOT NULL DEFAULT 0,
    "cod_amount" BIGINT NOT NULL,
    "tax_included" BOOLEAN NOT NULL DEFAULT true,
    "tax_amount" BIGINT,
    "tax_rate" DECIMAL(5,2),
    "applied_discount_id" UUID,
    "discount_snapshot_json" JSONB,
    "shipping_company_id" UUID,
    "shipping_rule_snapshot_json" JSONB NOT NULL,
    "shipping_address_snapshot_json" JSONB NOT NULL,
    "customer_snapshot_json" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "product_variant_id" UUID NOT NULL,
    "sku_snapshot" TEXT NOT NULL,
    "product_name_snapshot" JSONB NOT NULL,
    "variant_name_snapshot" JSONB,
    "image_snapshot" TEXT,
    "unit_price" BIGINT NOT NULL,
    "unit_cost_at_sale" BIGINT,
    "quantity" INTEGER NOT NULL,
    "discount_amount" BIGINT NOT NULL,
    "line_total" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_status_history" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "from_status" "order_status",
    "to_status" "order_status" NOT NULL,
    "changed_by_type" "audit_actor_type" NOT NULL,
    "changed_by_id" UUID,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "order_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checkout_attempts" (
    "id" UUID NOT NULL,
    "scope" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "cart_id" UUID NOT NULL,
    "result_order_id" UUID,
    "status" "checkout_attempt_status" NOT NULL,
    "request_fingerprint" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "completed_at" TIMESTAMPTZ(3),

    CONSTRAINT "checkout_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "orders_order_number_key" ON "orders"("order_number");

-- CreateIndex
CREATE INDEX "orders_customer_id_created_at_idx" ON "orders"("customer_id", "created_at");

-- CreateIndex
CREATE INDEX "orders_status_created_at_idx" ON "orders"("status", "created_at");

-- CreateIndex
CREATE INDEX "orders_guest_phone_idx" ON "orders"("guest_phone");

-- CreateIndex
CREATE INDEX "order_items_product_variant_id_idx" ON "order_items"("product_variant_id");

-- CreateIndex
CREATE UNIQUE INDEX "order_items_order_id_product_variant_id_key" ON "order_items"("order_id", "product_variant_id");

-- CreateIndex
CREATE INDEX "order_status_history_order_id_created_at_idx" ON "order_status_history"("order_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "checkout_attempts_result_order_id_key" ON "checkout_attempts"("result_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "checkout_attempts_scope_idempotency_key_key" ON "checkout_attempts"("scope", "idempotency_key");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_applied_discount_id_fkey" FOREIGN KEY ("applied_discount_id") REFERENCES "discounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_shipping_company_id_fkey" FOREIGN KEY ("shipping_company_id") REFERENCES "shipping_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_variant_id_fkey" FOREIGN KEY ("product_variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_status_history" ADD CONSTRAINT "order_status_history_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkout_attempts" ADD CONSTRAINT "checkout_attempts_cart_id_fkey" FOREIGN KEY ("cart_id") REFERENCES "carts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkout_attempts" ADD CONSTRAINT "checkout_attempts_result_order_id_fkey" FOREIGN KEY ("result_order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written (TASK-029, ADR-0035): order numbers, money invariants and
-- append-only status history.

CREATE SEQUENCE "order_number_seq" START WITH 100001;

ALTER TABLE "orders" ADD CONSTRAINT "orders_owner_check"
    CHECK ("customer_id" IS NOT NULL OR "guest_phone" IS NOT NULL);

ALTER TABLE "orders" ADD CONSTRAINT "orders_amounts_check"
    CHECK ("subtotal" > 0
       AND "discount_total" >= 0 AND "discount_total" <= "subtotal"
       AND "shipping_fee" >= 0
       AND "total" = "subtotal" - "discount_total" + "shipping_fee"
       AND "wallet_amount_reserved" >= 0 AND "wallet_amount_reserved" <= "total"
       AND "wallet_amount_captured" >= 0 AND "wallet_amount_captured" <= "wallet_amount_reserved"
       AND "cod_amount" = "total" - "wallet_amount_reserved");

ALTER TABLE "order_items" ADD CONSTRAINT "order_items_amounts_check"
    CHECK ("quantity" > 0 AND "unit_price" > 0
       AND "discount_amount" >= 0 AND "discount_amount" <= "unit_price" * "quantity"
       AND "line_total" = "unit_price" * "quantity" - "discount_amount");

ALTER TABLE "checkout_attempts" ADD CONSTRAINT "checkout_attempts_result_check"
    CHECK (("status" = 'SUCCEEDED') = ("result_order_id" IS NOT NULL));

CREATE FUNCTION "order_status_history_reject_change"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'order_status_history rows are append-only (% rejected)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER "order_status_history_append_only"
BEFORE UPDATE OR DELETE ON "order_status_history"
FOR EACH ROW EXECUTE FUNCTION "order_status_history_reject_change"();
