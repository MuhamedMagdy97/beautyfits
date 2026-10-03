-- CreateEnum
CREATE TYPE "purchase_order_status" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SENT', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CLOSED', 'CANCELLED');

-- Purchase numbers "PO-000001", "PO-000002", ... (ADR-0027).
CREATE SEQUENCE "purchase_order_number_seq";

-- CreateTable
CREATE TABLE "purchase_orders" (
    "id" UUID NOT NULL,
    "purchase_number" TEXT NOT NULL DEFAULT ('PO-'::text || lpad((nextval('purchase_order_number_seq'::regclass))::text, 6, '0'::text)),
    "supplier_id" UUID NOT NULL,
    "status" "purchase_order_status" NOT NULL DEFAULT 'DRAFT',
    "ordered_total" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'EGP',
    "notes" TEXT,
    "created_by_employee_id" UUID NOT NULL,
    "submitted_at" TIMESTAMPTZ(3),
    "approved_by_employee_id" UUID,
    "approved_at" TIMESTAMPTZ(3),
    "sent_at" TIMESTAMPTZ(3),
    "cancelled_by_employee_id" UUID,
    "cancelled_at" TIMESTAMPTZ(3),
    "cancellation_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_items" (
    "id" UUID NOT NULL,
    "purchase_order_id" UUID NOT NULL,
    "product_variant_id" UUID NOT NULL,
    "ordered_quantity" INTEGER NOT NULL,
    "unit_cost" BIGINT NOT NULL,
    "line_total" BIGINT NOT NULL,

    CONSTRAINT "purchase_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_purchase_number_key" ON "purchase_orders"("purchase_number");

-- CreateIndex
CREATE INDEX "purchase_orders_status_created_at_idx" ON "purchase_orders"("status", "created_at");

-- CreateIndex
CREATE INDEX "purchase_orders_supplier_id_created_at_idx" ON "purchase_orders"("supplier_id", "created_at");

-- CreateIndex
CREATE INDEX "purchase_items_product_variant_id_idx" ON "purchase_items"("product_variant_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_items_purchase_order_id_product_variant_id_key" ON "purchase_items"("purchase_order_id", "product_variant_id");

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_created_by_employee_id_fkey" FOREIGN KEY ("created_by_employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_approved_by_employee_id_fkey" FOREIGN KEY ("approved_by_employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_cancelled_by_employee_id_fkey" FOREIGN KEY ("cancelled_by_employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_items" ADD CONSTRAINT "purchase_items_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_items" ADD CONSTRAINT "purchase_items_product_variant_id_fkey" FOREIGN KEY ("product_variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER SEQUENCE "purchase_order_number_seq" OWNED BY "purchase_orders"."purchase_number";

-- Quantities and costs are positive; a line total is quantity × unit cost.
ALTER TABLE "purchase_items" ADD CONSTRAINT "purchase_items_amounts_check"
  CHECK ("ordered_quantity" > 0 AND "unit_cost" > 0 AND "line_total" = "ordered_quantity" * "unit_cost");
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_total_check"
  CHECK ("ordered_total" >= 0);

-- Purchase orders are cancelled, never deleted (ADR-0027).
CREATE TRIGGER "purchase_orders_no_delete"
BEFORE DELETE ON "purchase_orders"
FOR EACH ROW EXECUTE FUNCTION "catalog_reject_delete"();

-- Lines change only while their order is a DRAFT: what was submitted,
-- approved and sent stays as it was.
CREATE FUNCTION "purchase_items_draft_only"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  order_status "purchase_order_status";
BEGIN
  SELECT "status" INTO order_status FROM "purchase_orders"
  WHERE "id" = COALESCE(NEW."purchase_order_id", OLD."purchase_order_id");
  IF order_status IS DISTINCT FROM 'DRAFT'
     OR (TG_OP = 'UPDATE' AND NEW."purchase_order_id" <> OLD."purchase_order_id") THEN
    RAISE EXCEPTION 'purchase_items change only while the purchase order is DRAFT (% rejected)', TG_OP
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER "purchase_items_draft_only"
BEFORE INSERT OR UPDATE OR DELETE ON "purchase_items"
FOR EACH ROW EXECUTE FUNCTION "purchase_items_draft_only"();
