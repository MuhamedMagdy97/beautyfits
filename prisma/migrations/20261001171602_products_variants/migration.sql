-- CreateEnum
CREATE TYPE "product_status" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED', 'DISABLED');

-- CreateEnum
CREATE TYPE "product_variant_status" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL,
    "name_ar" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description_ar" TEXT,
    "description_en" TEXT,
    "status" "product_status" NOT NULL DEFAULT 'DRAFT',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archived_at" TIMESTAMPTZ(3),

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_variants" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "sku" TEXT NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "variant_name_ar" TEXT,
    "variant_name_en" TEXT,
    "attributes_json" JSONB,
    "status" "product_variant_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archived_at" TIMESTAMPTZ(3),

    CONSTRAINT "product_variants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "products_slug_key" ON "products"("slug");

-- CreateIndex
CREATE INDEX "products_status_created_at_idx" ON "products"("status", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "product_variants_sku_key" ON "product_variants"("sku");

-- CreateIndex
CREATE INDEX "product_variants_product_id_created_at_idx" ON "product_variants"("product_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "product_variants_one_default_key" ON "product_variants"("product_id") WHERE (is_default);

-- AddForeignKey
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The default variant is always a sellable (ACTIVE) one (C6, ADR-0019).
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_default_active_check"
  CHECK (NOT "is_default" OR "status" = 'ACTIVE');

-- SKUs are stored uppercase so uniqueness ignores case (ADR-0019).
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_sku_upper_check"
  CHECK ("sku" = upper("sku"));

-- Slugs are lowercase Latin (DB design §5).
ALTER TABLE "products" ADD CONSTRAINT "products_slug_format_check"
  CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$');

-- Products and variants are archived, never hard-deleted (Q75, DB design §5).
-- TRUNCATE (used only by the integration test reset) does not fire row
-- triggers.
CREATE FUNCTION "catalog_reject_delete"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% rows are archived, never deleted', TG_TABLE_NAME
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER "products_no_delete"
BEFORE DELETE ON "products"
FOR EACH ROW EXECUTE FUNCTION "catalog_reject_delete"();

CREATE TRIGGER "product_variants_no_delete"
BEFORE DELETE ON "product_variants"
FOR EACH ROW EXECUTE FUNCTION "catalog_reject_delete"();
