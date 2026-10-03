-- AlterEnum
ALTER TYPE "inventory_movement_type" ADD VALUE 'PURCHASE_RECEIPT';

-- AlterEnum
ALTER TYPE "media_purpose" ADD VALUE 'SUPPLIER_INVOICE';

-- AlterTable
ALTER TABLE "purchase_orders" ADD COLUMN     "closed_at" TIMESTAMPTZ(3),
ADD COLUMN     "closed_by_employee_id" UUID,
ADD COLUMN     "closing_reason" TEXT;

-- Receipt numbers "GR-000001", "GR-000002", ... (ADR-0028).
CREATE SEQUENCE "goods_receipt_number_seq";

-- CreateTable
CREATE TABLE "goods_receipts" (
    "id" UUID NOT NULL,
    "receipt_number" TEXT NOT NULL DEFAULT ('GR-'::text || lpad((nextval('goods_receipt_number_seq'::regclass))::text, 6, '0'::text)),
    "purchase_order_id" UUID NOT NULL,
    "received_by_employee_id" UUID NOT NULL,
    "received_at" TIMESTAMPTZ(3) NOT NULL,
    "notes" TEXT,

    CONSTRAINT "goods_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goods_receipt_items" (
    "id" UUID NOT NULL,
    "goods_receipt_id" UUID NOT NULL,
    "purchase_item_id" UUID NOT NULL,
    "delivered_quantity" INTEGER NOT NULL,
    "accepted_quantity" INTEGER NOT NULL,
    "damaged_quantity" INTEGER NOT NULL,
    "over_delivery_quantity" INTEGER NOT NULL,
    "inspection_notes" TEXT,

    CONSTRAINT "goods_receipt_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_invoices" (
    "id" UUID NOT NULL,
    "purchase_order_id" UUID NOT NULL,
    "invoice_number" TEXT NOT NULL,
    "invoice_date" DATE NOT NULL,
    "invoice_total" BIGINT NOT NULL,
    "tax_amount" BIGINT,
    "media_asset_id" UUID NOT NULL,
    "notes" TEXT,
    "recorded_by_employee_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "goods_receipts_receipt_number_key" ON "goods_receipts"("receipt_number");

-- CreateIndex
CREATE INDEX "goods_receipts_purchase_order_id_received_at_idx" ON "goods_receipts"("purchase_order_id", "received_at");

-- CreateIndex
CREATE INDEX "goods_receipt_items_purchase_item_id_idx" ON "goods_receipt_items"("purchase_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "goods_receipt_items_goods_receipt_id_purchase_item_id_key" ON "goods_receipt_items"("goods_receipt_id", "purchase_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_invoices_media_asset_id_key" ON "purchase_invoices"("media_asset_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_invoices_purchase_order_id_invoice_number_key" ON "purchase_invoices"("purchase_order_id", "invoice_number");

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_closed_by_employee_id_fkey" FOREIGN KEY ("closed_by_employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_received_by_employee_id_fkey" FOREIGN KEY ("received_by_employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_items" ADD CONSTRAINT "goods_receipt_items_goods_receipt_id_fkey" FOREIGN KEY ("goods_receipt_id") REFERENCES "goods_receipts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_items" ADD CONSTRAINT "goods_receipt_items_purchase_item_id_fkey" FOREIGN KEY ("purchase_item_id") REFERENCES "purchase_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_media_asset_id_fkey" FOREIGN KEY ("media_asset_id") REFERENCES "media_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_recorded_by_employee_id_fkey" FOREIGN KEY ("recorded_by_employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER SEQUENCE "goods_receipt_number_seq" OWNED BY "goods_receipts"."receipt_number";

-- Delivered = accepted + damaged + over-delivery; nothing negative; a line
-- records at least one unit.
ALTER TABLE "goods_receipt_items" ADD CONSTRAINT "goods_receipt_items_quantities_check"
  CHECK ("accepted_quantity" >= 0 AND "damaged_quantity" >= 0 AND "over_delivery_quantity" >= 0
     AND "delivered_quantity" > 0
     AND "delivered_quantity" = "accepted_quantity" + "damaged_quantity" + "over_delivery_quantity");

-- Invoice amounts as issued: a positive total, tax within it.
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_amounts_check"
  CHECK ("invoice_total" > 0 AND ("tax_amount" IS NULL OR ("tax_amount" >= 0 AND "tax_amount" <= "invoice_total")));

-- Closing records who, when and why.
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_closed_check"
  CHECK (("status" = 'CLOSED') = ("closed_at" IS NOT NULL AND "closed_by_employee_id" IS NOT NULL AND "closing_reason" IS NOT NULL));

-- Receipts and invoices are history (Q115, Q117): never changed or deleted.
CREATE FUNCTION "purchasing_reject_change"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% rows are append-only (% rejected)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER "goods_receipts_append_only"
BEFORE UPDATE OR DELETE ON "goods_receipts"
FOR EACH ROW EXECUTE FUNCTION "purchasing_reject_change"();

CREATE TRIGGER "goods_receipt_items_append_only"
BEFORE UPDATE OR DELETE ON "goods_receipt_items"
FOR EACH ROW EXECUTE FUNCTION "purchasing_reject_change"();

CREATE TRIGGER "purchase_invoices_append_only"
BEFORE UPDATE OR DELETE ON "purchase_invoices"
FOR EACH ROW EXECUTE FUNCTION "purchasing_reject_change"();
