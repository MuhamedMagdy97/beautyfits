-- CreateEnum
CREATE TYPE "inventory_reservation_status" AS ENUM ('ACTIVE', 'RELEASED', 'CONVERTED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "inventory_movement_type" ADD VALUE 'RESERVATION';
ALTER TYPE "inventory_movement_type" ADD VALUE 'RELEASE_RESERVATION';
ALTER TYPE "inventory_movement_type" ADD VALUE 'CUSTOMER_ORDER_COMMIT';

-- CreateTable
CREATE TABLE "inventory_reservations" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "product_variant_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "status" "inventory_reservation_status" NOT NULL DEFAULT 'ACTIVE',
    "reserved_at" TIMESTAMPTZ(3) NOT NULL,
    "released_at" TIMESTAMPTZ(3),
    "converted_at" TIMESTAMPTZ(3),

    CONSTRAINT "inventory_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "inventory_reservations_product_variant_id_status_idx" ON "inventory_reservations"("product_variant_id", "status");

-- CreateIndex
CREATE INDEX "inventory_reservations_order_id_idx" ON "inventory_reservations"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_reservations_one_active_key" ON "inventory_reservations"("order_id", "product_variant_id") WHERE (status = 'ACTIVE');

-- AddForeignKey
ALTER TABLE "inventory_reservations" ADD CONSTRAINT "inventory_reservations_product_variant_id_fkey" FOREIGN KEY ("product_variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A reservation holds a positive quantity; its timestamps match its status.
ALTER TABLE "inventory_reservations" ADD CONSTRAINT "inventory_reservations_quantity_check"
  CHECK ("quantity" > 0);
ALTER TABLE "inventory_reservations" ADD CONSTRAINT "inventory_reservations_status_check"
  CHECK (
    ("status" = 'ACTIVE' AND "released_at" IS NULL AND "converted_at" IS NULL)
    OR ("status" = 'RELEASED' AND "released_at" IS NOT NULL AND "converted_at" IS NULL)
    OR ("status" = 'CONVERTED' AND "converted_at" IS NOT NULL AND "released_at" IS NULL)
  );

-- History is kept (ADR-0025): a reservation is never deleted, and the only
-- change is ACTIVE → RELEASED or ACTIVE → CONVERTED, once.
CREATE FUNCTION "inventory_reservations_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE'
     OR OLD."status" <> 'ACTIVE'
     OR NEW."order_id" <> OLD."order_id"
     OR NEW."product_variant_id" <> OLD."product_variant_id"
     OR NEW."quantity" <> OLD."quantity"
     OR NEW."reserved_at" <> OLD."reserved_at" THEN
    RAISE EXCEPTION 'inventory_reservations only move from ACTIVE to RELEASED or CONVERTED (% rejected)', TG_OP
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "inventory_reservations_guard"
BEFORE UPDATE OR DELETE ON "inventory_reservations"
FOR EACH ROW EXECUTE FUNCTION "inventory_reservations_guard"();
