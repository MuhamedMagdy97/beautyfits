-- CreateEnum
CREATE TYPE "inventory_movement_type" AS ENUM ('MANUAL_ADJUSTMENT', 'DAMAGE', 'DAMAGE_WRITE_OFF');

-- AlterTable
ALTER TABLE "product_variants" ADD COLUMN     "low_stock_threshold" INTEGER;

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "low_stock_threshold" INTEGER;

-- CreateTable
CREATE TABLE "inventory_balances" (
    "product_variant_id" UUID NOT NULL,
    "available_quantity" INTEGER NOT NULL DEFAULT 0,
    "reserved_quantity" INTEGER NOT NULL DEFAULT 0,
    "damaged_quantity" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_balances_pkey" PRIMARY KEY ("product_variant_id")
);

-- CreateTable
CREATE TABLE "inventory_movements" (
    "id" UUID NOT NULL,
    "product_variant_id" UUID NOT NULL,
    "movement_type" "inventory_movement_type" NOT NULL,
    "available_delta" INTEGER NOT NULL DEFAULT 0,
    "reserved_delta" INTEGER NOT NULL DEFAULT 0,
    "damaged_delta" INTEGER NOT NULL DEFAULT 0,
    "reference_type" TEXT,
    "reference_id" UUID,
    "unit_cost" BIGINT,
    "reason" TEXT,
    "created_by_type" "audit_actor_type" NOT NULL,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_movements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "inventory_movements_product_variant_id_created_at_idx" ON "inventory_movements"("product_variant_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "inventory_balances" ADD CONSTRAINT "inventory_balances_product_variant_id_fkey" FOREIGN KEY ("product_variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_product_variant_id_fkey" FOREIGN KEY ("product_variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Thresholds and quantities are never negative (ADR-0024).
ALTER TABLE "products" ADD CONSTRAINT "products_low_stock_threshold_check"
  CHECK ("low_stock_threshold" IS NULL OR "low_stock_threshold" >= 0);
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_low_stock_threshold_check"
  CHECK ("low_stock_threshold" IS NULL OR "low_stock_threshold" >= 0);
ALTER TABLE "inventory_balances" ADD CONSTRAINT "inventory_balances_quantities_check"
  CHECK ("available_quantity" >= 0 AND "reserved_quantity" >= 0 AND "damaged_quantity" >= 0);
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_delta_check"
  CHECK ("available_delta" <> 0 OR "reserved_delta" <> 0 OR "damaged_delta" <> 0);
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_unit_cost_check"
  CHECK ("unit_cost" IS NULL OR "unit_cost" >= 0);

-- One balance per variant (DB design §10): created with the variant, and for
-- the variants that already exist.
INSERT INTO "inventory_balances" ("product_variant_id", "updated_at")
SELECT "id", "created_at" FROM "product_variants";

CREATE FUNCTION "inventory_balances_create"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO "inventory_balances" ("product_variant_id", "updated_at")
  VALUES (NEW."id", NEW."created_at");
  RETURN NULL;
END;
$$;

CREATE TRIGGER "inventory_balances_create"
AFTER INSERT ON "product_variants"
FOR EACH ROW EXECUTE FUNCTION "inventory_balances_create"();

-- The ledger is the only way stock changes (Q108): inserting a movement
-- applies its deltas to the balance; the quantities check rejects any that
-- would go below zero. TRUNCATE (the integration test reset) does not fire
-- row triggers.
CREATE FUNCTION "inventory_movements_apply"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "inventory_balances" SET
    "available_quantity" = "available_quantity" + NEW."available_delta",
    "reserved_quantity" = "reserved_quantity" + NEW."reserved_delta",
    "damaged_quantity" = "damaged_quantity" + NEW."damaged_delta",
    "updated_at" = NEW."created_at"
  WHERE "product_variant_id" = NEW."product_variant_id";
  RETURN NULL;
END;
$$;

CREATE TRIGGER "inventory_movements_apply"
AFTER INSERT ON "inventory_movements"
FOR EACH ROW EXECUTE FUNCTION "inventory_movements_apply"();

CREATE FUNCTION "inventory_movements_reject_change"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'inventory_movements rows are append-only (% rejected)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER "inventory_movements_append_only"
BEFORE UPDATE OR DELETE ON "inventory_movements"
FOR EACH ROW EXECUTE FUNCTION "inventory_movements_reject_change"();

-- Balances change only through the movement trigger above (nested, so
-- pg_trigger_depth() > 1), and are never deleted.
CREATE FUNCTION "inventory_balances_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR pg_trigger_depth() < 2 THEN
    RAISE EXCEPTION 'inventory_balances change only through inventory_movements (% rejected)', TG_OP
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "inventory_balances_guard"
BEFORE UPDATE OR DELETE ON "inventory_balances"
FOR EACH ROW EXECUTE FUNCTION "inventory_balances_guard"();
