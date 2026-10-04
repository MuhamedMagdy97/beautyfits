-- CreateEnum
CREATE TYPE "discount_status" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "discount_type" AS ENUM ('PERCENTAGE');

-- CreateEnum
CREATE TYPE "discount_scope" AS ENUM ('STORE_WIDE', 'TARGETED');

-- AlterTable
ALTER TABLE "carts" ADD COLUMN     "discount_id" UUID;

-- CreateTable
CREATE TABLE "discounts" (
    "id" UUID NOT NULL,
    "code" TEXT,
    "name_ar" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "discount_type" "discount_type" NOT NULL DEFAULT 'PERCENTAGE',
    "value" INTEGER NOT NULL,
    "scope" "discount_scope" NOT NULL,
    "max_discount_amount" BIGINT,
    "minimum_order_total" BIGINT,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3),
    "usage_limit_total" INTEGER,
    "usage_limit_per_customer" INTEGER,
    "status" "discount_status" NOT NULL DEFAULT 'INACTIVE',
    "created_by_employee_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "discounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discount_products" (
    "discount_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,

    CONSTRAINT "discount_products_pkey" PRIMARY KEY ("discount_id","product_id")
);

-- CreateTable
CREATE TABLE "discount_categories" (
    "discount_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,

    CONSTRAINT "discount_categories_pkey" PRIMARY KEY ("discount_id","category_id")
);

-- CreateTable
CREATE TABLE "discount_brands" (
    "discount_id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,

    CONSTRAINT "discount_brands_pkey" PRIMARY KEY ("discount_id","brand_id")
);

-- CreateTable
CREATE TABLE "discount_usages" (
    "id" UUID NOT NULL,
    "discount_id" UUID NOT NULL,
    "customer_id" UUID,
    "order_id" UUID NOT NULL,
    "discount_amount" BIGINT NOT NULL,
    "used_at" TIMESTAMPTZ(3) NOT NULL,
    "released_at" TIMESTAMPTZ(3),

    CONSTRAINT "discount_usages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "discounts_code_key" ON "discounts"("code");

-- CreateIndex
CREATE INDEX "discounts_status_starts_at_idx" ON "discounts"("status", "starts_at");

-- CreateIndex
CREATE INDEX "discount_products_product_id_idx" ON "discount_products"("product_id");

-- CreateIndex
CREATE INDEX "discount_categories_category_id_idx" ON "discount_categories"("category_id");

-- CreateIndex
CREATE INDEX "discount_brands_brand_id_idx" ON "discount_brands"("brand_id");

-- CreateIndex
CREATE UNIQUE INDEX "discount_usages_order_id_key" ON "discount_usages"("order_id");

-- CreateIndex
CREATE INDEX "discount_usages_discount_id_released_at_idx" ON "discount_usages"("discount_id", "released_at");

-- CreateIndex
CREATE INDEX "discount_usages_customer_id_discount_id_idx" ON "discount_usages"("customer_id", "discount_id");

-- AddForeignKey
ALTER TABLE "carts" ADD CONSTRAINT "carts_discount_id_fkey" FOREIGN KEY ("discount_id") REFERENCES "discounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discounts" ADD CONSTRAINT "discounts_created_by_employee_id_fkey" FOREIGN KEY ("created_by_employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discount_products" ADD CONSTRAINT "discount_products_discount_id_fkey" FOREIGN KEY ("discount_id") REFERENCES "discounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discount_products" ADD CONSTRAINT "discount_products_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discount_categories" ADD CONSTRAINT "discount_categories_discount_id_fkey" FOREIGN KEY ("discount_id") REFERENCES "discounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discount_categories" ADD CONSTRAINT "discount_categories_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discount_brands" ADD CONSTRAINT "discount_brands_discount_id_fkey" FOREIGN KEY ("discount_id") REFERENCES "discounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discount_brands" ADD CONSTRAINT "discount_brands_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discount_usages" ADD CONSTRAINT "discount_usages_discount_id_fkey" FOREIGN KEY ("discount_id") REFERENCES "discounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discount_usages" ADD CONSTRAINT "discount_usages_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Discounts are never deleted: deactivated instead (orders keep a snapshot).
CREATE TRIGGER "discounts_no_delete"
BEFORE DELETE ON "discounts"
FOR EACH ROW EXECUTE FUNCTION "catalog_reject_delete"();

ALTER TABLE "discounts" ADD CONSTRAINT "discounts_value_check" CHECK ("value" BETWEEN 1 AND 100);
ALTER TABLE "discounts" ADD CONSTRAINT "discounts_amounts_check"
    CHECK (("max_discount_amount" IS NULL OR "max_discount_amount" > 0)
       AND ("minimum_order_total" IS NULL OR "minimum_order_total" > 0));
ALTER TABLE "discounts" ADD CONSTRAINT "discounts_limits_check"
    CHECK (("usage_limit_total" IS NULL OR "usage_limit_total" > 0)
       AND ("usage_limit_per_customer" IS NULL OR "usage_limit_per_customer" > 0));
ALTER TABLE "discounts" ADD CONSTRAINT "discounts_period_check"
    CHECK ("ends_at" IS NULL OR "ends_at" > "starts_at");
ALTER TABLE "discounts" ADD CONSTRAINT "discounts_code_upper_check"
    CHECK ("code" IS NULL OR "code" = upper("code"));
ALTER TABLE "discount_usages" ADD CONSTRAINT "discount_usages_amount_check"
    CHECK ("discount_amount" >= 0);
