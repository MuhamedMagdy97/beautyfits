-- CreateEnum
CREATE TYPE "supplier_return_status" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'SETTLED');

-- CreateEnum
CREATE TYPE "supplier_return_resolution" AS ENUM ('REFUND', 'CREDIT', 'OTHER');

-- CreateEnum
CREATE TYPE "supplier_payment_method" AS ENUM ('CASH', 'BANK_TRANSFER', 'CHEQUE', 'OTHER');

-- CreateEnum
CREATE TYPE "supplier_ledger_entry_type" AS ENUM ('INVOICE', 'PAYMENT', 'CREDIT', 'REFUND', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "supplier_ledger_direction" AS ENUM ('CREDIT', 'DEBIT');

-- AlterEnum
ALTER TYPE "approval_type" ADD VALUE 'SUPPLIER_RETURN';

-- AlterEnum
ALTER TYPE "inventory_movement_type" ADD VALUE 'SUPPLIER_RETURN';

-- Return numbers "SR-000001", "SR-000002", ... (ADR-0029).
CREATE SEQUENCE "supplier_return_number_seq";

-- CreateTable
CREATE TABLE "supplier_returns" (
    "id" UUID NOT NULL,
    "return_number" TEXT NOT NULL DEFAULT ('SR-'::text || lpad((nextval('supplier_return_number_seq'::regclass))::text, 6, '0'::text)),
    "supplier_id" UUID NOT NULL,
    "purchase_order_id" UUID NOT NULL,
    "status" "supplier_return_status" NOT NULL DEFAULT 'DRAFT',
    "reason" TEXT NOT NULL,
    "expected_amount" BIGINT NOT NULL,
    "financial_resolution" "supplier_return_resolution",
    "financial_amount" BIGINT,
    "settlement_notes" TEXT,
    "created_by_employee_id" UUID NOT NULL,
    "submitted_at" TIMESTAMPTZ(3),
    "approved_by_employee_id" UUID,
    "approved_at" TIMESTAMPTZ(3),
    "settled_by_employee_id" UUID,
    "settled_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_return_items" (
    "id" UUID NOT NULL,
    "supplier_return_id" UUID NOT NULL,
    "goods_receipt_item_id" UUID NOT NULL,
    "purchase_item_id" UUID NOT NULL,
    "product_variant_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_cost" BIGINT NOT NULL,
    "reason" TEXT,

    CONSTRAINT "supplier_return_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_payments" (
    "id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "purchase_order_id" UUID,
    "amount" BIGINT NOT NULL,
    "method" "supplier_payment_method" NOT NULL,
    "paid_on" DATE NOT NULL,
    "reference" TEXT,
    "notes" TEXT,
    "recorded_by_employee_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_ledger_entries" (
    "id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "purchase_order_id" UUID,
    "supplier_return_id" UUID,
    "purchase_invoice_id" UUID,
    "supplier_payment_id" UUID,
    "entry_type" "supplier_ledger_entry_type" NOT NULL,
    "direction" "supplier_ledger_direction" NOT NULL,
    "amount" BIGINT NOT NULL,
    "reference" TEXT,
    "created_by_employee_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "supplier_returns_return_number_key" ON "supplier_returns"("return_number");

-- CreateIndex
CREATE INDEX "supplier_returns_purchase_order_id_created_at_idx" ON "supplier_returns"("purchase_order_id", "created_at");

-- CreateIndex
CREATE INDEX "supplier_returns_supplier_id_created_at_idx" ON "supplier_returns"("supplier_id", "created_at");

-- CreateIndex
CREATE INDEX "supplier_returns_status_created_at_idx" ON "supplier_returns"("status", "created_at");

-- CreateIndex
CREATE INDEX "supplier_return_items_goods_receipt_item_id_idx" ON "supplier_return_items"("goods_receipt_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_return_items_supplier_return_id_goods_receipt_item_key" ON "supplier_return_items"("supplier_return_id", "goods_receipt_item_id");

-- CreateIndex
CREATE INDEX "supplier_payments_supplier_id_created_at_idx" ON "supplier_payments"("supplier_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_ledger_entries_purchase_invoice_id_key" ON "supplier_ledger_entries"("purchase_invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_ledger_entries_supplier_payment_id_key" ON "supplier_ledger_entries"("supplier_payment_id");

-- CreateIndex
CREATE INDEX "supplier_ledger_entries_supplier_id_created_at_idx" ON "supplier_ledger_entries"("supplier_id", "created_at");

-- CreateIndex
CREATE INDEX "supplier_ledger_entries_purchase_order_id_idx" ON "supplier_ledger_entries"("purchase_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_ledger_entries_supplier_return_id_entry_type_key" ON "supplier_ledger_entries"("supplier_return_id", "entry_type");

-- AddForeignKey
ALTER TABLE "supplier_returns" ADD CONSTRAINT "supplier_returns_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_returns" ADD CONSTRAINT "supplier_returns_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_returns" ADD CONSTRAINT "supplier_returns_created_by_employee_id_fkey" FOREIGN KEY ("created_by_employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_returns" ADD CONSTRAINT "supplier_returns_approved_by_employee_id_fkey" FOREIGN KEY ("approved_by_employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_returns" ADD CONSTRAINT "supplier_returns_settled_by_employee_id_fkey" FOREIGN KEY ("settled_by_employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_return_items" ADD CONSTRAINT "supplier_return_items_supplier_return_id_fkey" FOREIGN KEY ("supplier_return_id") REFERENCES "supplier_returns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_return_items" ADD CONSTRAINT "supplier_return_items_goods_receipt_item_id_fkey" FOREIGN KEY ("goods_receipt_item_id") REFERENCES "goods_receipt_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_return_items" ADD CONSTRAINT "supplier_return_items_purchase_item_id_fkey" FOREIGN KEY ("purchase_item_id") REFERENCES "purchase_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_return_items" ADD CONSTRAINT "supplier_return_items_product_variant_id_fkey" FOREIGN KEY ("product_variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_recorded_by_employee_id_fkey" FOREIGN KEY ("recorded_by_employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_ledger_entries" ADD CONSTRAINT "supplier_ledger_entries_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_ledger_entries" ADD CONSTRAINT "supplier_ledger_entries_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_ledger_entries" ADD CONSTRAINT "supplier_ledger_entries_supplier_return_id_fkey" FOREIGN KEY ("supplier_return_id") REFERENCES "supplier_returns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_ledger_entries" ADD CONSTRAINT "supplier_ledger_entries_purchase_invoice_id_fkey" FOREIGN KEY ("purchase_invoice_id") REFERENCES "purchase_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_ledger_entries" ADD CONSTRAINT "supplier_ledger_entries_supplier_payment_id_fkey" FOREIGN KEY ("supplier_payment_id") REFERENCES "supplier_payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_ledger_entries" ADD CONSTRAINT "supplier_ledger_entries_created_by_employee_id_fkey" FOREIGN KEY ("created_by_employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER SEQUENCE "supplier_return_number_seq" OWNED BY "supplier_returns"."return_number";

-- Amounts in piastres; approval and settlement record who and when.
ALTER TABLE "supplier_returns" ADD CONSTRAINT "supplier_returns_amounts_check"
  CHECK ("expected_amount" > 0 AND ("financial_amount" IS NULL OR "financial_amount" >= 0)
     AND ("financial_resolution" IS NULL OR ("financial_resolution" = 'OTHER') = ("financial_amount" = 0)));
ALTER TABLE "supplier_returns" ADD CONSTRAINT "supplier_returns_approved_check"
  CHECK (("status" IN ('APPROVED', 'SETTLED')) = ("approved_at" IS NOT NULL AND "approved_by_employee_id" IS NOT NULL));
ALTER TABLE "supplier_returns" ADD CONSTRAINT "supplier_returns_settled_check"
  CHECK (("status" = 'SETTLED') = ("settled_at" IS NOT NULL AND "settled_by_employee_id" IS NOT NULL
     AND "financial_resolution" IS NOT NULL AND "financial_amount" IS NOT NULL));

ALTER TABLE "supplier_return_items" ADD CONSTRAINT "supplier_return_items_amounts_check"
  CHECK ("quantity" > 0 AND "unit_cost" > 0);

ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_amount_check"
  CHECK ("amount" > 0);

-- The direction follows the entry type; each entry points at its source.
ALTER TABLE "supplier_ledger_entries" ADD CONSTRAINT "supplier_ledger_entries_check"
  CHECK ("amount" > 0 AND CASE "entry_type"
    WHEN 'INVOICE' THEN "direction" = 'CREDIT' AND "purchase_invoice_id" IS NOT NULL
    WHEN 'PAYMENT' THEN "direction" = 'DEBIT' AND "supplier_payment_id" IS NOT NULL
    WHEN 'CREDIT' THEN "direction" = 'DEBIT' AND "supplier_return_id" IS NOT NULL
    WHEN 'REFUND' THEN "direction" = 'CREDIT' AND "supplier_return_id" IS NOT NULL
    ELSE TRUE END);

-- Ledger, payments and return lines are history: never changed or deleted.
CREATE TRIGGER "supplier_ledger_entries_append_only"
BEFORE UPDATE OR DELETE ON "supplier_ledger_entries"
FOR EACH ROW EXECUTE FUNCTION "purchasing_reject_change"();

CREATE TRIGGER "supplier_payments_append_only"
BEFORE UPDATE OR DELETE ON "supplier_payments"
FOR EACH ROW EXECUTE FUNCTION "purchasing_reject_change"();

CREATE TRIGGER "supplier_return_items_append_only"
BEFORE UPDATE OR DELETE ON "supplier_return_items"
FOR EACH ROW EXECUTE FUNCTION "purchasing_reject_change"();

CREATE TRIGGER "supplier_returns_no_delete"
BEFORE DELETE ON "supplier_returns"
FOR EACH ROW EXECUTE FUNCTION "purchasing_reject_change"();

-- Invoices recorded before the ledger existed become payable entries (ADR-0029).
INSERT INTO "supplier_ledger_entries"
  ("id", "supplier_id", "purchase_order_id", "purchase_invoice_id", "entry_type", "direction",
   "amount", "reference", "created_by_employee_id", "created_at")
SELECT gen_random_uuid(), po."supplier_id", i."purchase_order_id", i."id", 'INVOICE', 'CREDIT',
       i."invoice_total", i."invoice_number", i."recorded_by_employee_id", i."created_at"
FROM "purchase_invoices" i
JOIN "purchase_orders" po ON po."id" = i."purchase_order_id";
