-- CreateEnum
CREATE TYPE "return_status" AS ENUM ('PENDING_APPROVAL', 'APPROVED', 'PICKUP_SCHEDULED', 'RECEIVED', 'INSPECTING', 'PARTIALLY_COMPLETED', 'COMPLETED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "return_claim_type" AS ENUM ('DAMAGED', 'WRONG_ITEM', 'OTHER');

-- AlterEnum
ALTER TYPE "media_purpose" ADD VALUE 'RETURN_EVIDENCE';

-- AlterTable
ALTER TABLE "media_assets" ADD COLUMN     "created_by_customer_id" UUID;

-- CreateSequence
CREATE SEQUENCE "return_number_seq";

-- CreateTable
CREATE TABLE "returns" (
    "id" UUID NOT NULL,
    "return_number" TEXT NOT NULL DEFAULT ('RT-'::text || lpad((nextval('return_number_seq'::regclass))::text, 6, '0'::text)),
    "order_id" UUID NOT NULL,
    "customer_id" UUID,
    "status" "return_status" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "claim_type" "return_claim_type" NOT NULL,
    "customer_reason_text" TEXT NOT NULL,
    "resubmitted_from_return_id" UUID,
    "cancelled_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "return_items" (
    "id" UUID NOT NULL,
    "return_id" UUID NOT NULL,
    "order_item_id" UUID NOT NULL,
    "requested_quantity" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "return_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "return_evidence" (
    "id" UUID NOT NULL,
    "return_id" UUID NOT NULL,
    "media_asset_id" UUID NOT NULL,
    "uploaded_by_type" "audit_actor_type" NOT NULL,
    "uploaded_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "return_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "returns_return_number_key" ON "returns"("return_number");

-- CreateIndex
CREATE INDEX "returns_customer_id_created_at_idx" ON "returns"("customer_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "returns_status_created_at_idx" ON "returns"("status", "created_at");

-- CreateIndex
CREATE INDEX "returns_order_id_idx" ON "returns"("order_id");

-- CreateIndex
CREATE INDEX "return_items_order_item_id_idx" ON "return_items"("order_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "return_items_return_id_order_item_id_key" ON "return_items"("return_id", "order_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "return_evidence_media_asset_id_key" ON "return_evidence"("media_asset_id");

-- CreateIndex
CREATE INDEX "return_evidence_return_id_created_at_idx" ON "return_evidence"("return_id", "created_at");

-- CreateIndex
CREATE INDEX "media_assets_created_by_customer_id_created_at_idx" ON "media_assets"("created_by_customer_id", "created_at");

-- AddForeignKey
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_created_by_customer_id_fkey" FOREIGN KEY ("created_by_customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "returns" ADD CONSTRAINT "returns_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "returns" ADD CONSTRAINT "returns_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "returns" ADD CONSTRAINT "returns_resubmitted_from_return_id_fkey" FOREIGN KEY ("resubmitted_from_return_id") REFERENCES "returns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_items" ADD CONSTRAINT "return_items_return_id_fkey" FOREIGN KEY ("return_id") REFERENCES "returns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_items" ADD CONSTRAINT "return_items_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_evidence" ADD CONSTRAINT "return_evidence_return_id_fkey" FOREIGN KEY ("return_id") REFERENCES "returns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_evidence" ADD CONSTRAINT "return_evidence_media_asset_id_fkey" FOREIGN KEY ("media_asset_id") REFERENCES "media_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written (TASK-037, ADR-0049).
ALTER SEQUENCE "return_number_seq" OWNED BY "returns"."return_number";

ALTER TABLE "returns" ADD CONSTRAINT "returns_reason_check" CHECK (btrim("customer_reason_text") <> '');
ALTER TABLE "returns" ADD CONSTRAINT "returns_cancelled_at_check" CHECK (("status" = 'CANCELLED') = ("cancelled_at" IS NOT NULL));
ALTER TABLE "return_items" ADD CONSTRAINT "return_items_quantity_check" CHECK ("requested_quantity" > 0);
-- A file is uploaded by an employee or by a customer, never both.
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_one_creator_check" CHECK ("created_by_employee_id" IS NULL OR "created_by_customer_id" IS NULL);

-- Returns keep their history (Q92): returns and their items are never
-- deleted; evidence is append-only. TRUNCATE (integration test reset only)
-- does not fire row triggers.
CREATE FUNCTION "returns_reject_change"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% rows keep their history (% rejected)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER "returns_no_delete"
BEFORE DELETE ON "returns"
FOR EACH ROW EXECUTE FUNCTION "returns_reject_change"();

CREATE TRIGGER "return_items_no_delete"
BEFORE DELETE ON "return_items"
FOR EACH ROW EXECUTE FUNCTION "returns_reject_change"();

CREATE TRIGGER "return_evidence_append_only"
BEFORE UPDATE OR DELETE ON "return_evidence"
FOR EACH ROW EXECUTE FUNCTION "returns_reject_change"();
