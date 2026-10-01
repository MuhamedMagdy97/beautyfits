-- CreateEnum
CREATE TYPE "media_scan_status" AS ENUM ('PENDING', 'SAFE', 'REJECTED');

-- CreateEnum
CREATE TYPE "media_purpose" AS ENUM ('PRODUCT_MEDIA');

-- CreateTable
CREATE TABLE "media_assets" (
    "id" UUID NOT NULL,
    "storage_provider" TEXT NOT NULL,
    "object_key" TEXT NOT NULL,
    "original_filename" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "checksum" TEXT,
    "scan_status" "media_scan_status" NOT NULL DEFAULT 'PENDING',
    "purpose" "media_purpose" NOT NULL,
    "rejection_reason" TEXT,
    "upload_token_hash" TEXT,
    "upload_expires_at" TIMESTAMPTZ(3) NOT NULL,
    "uploaded_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "created_by_employee_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "media_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_media" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "variant_id" UUID,
    "media_asset_id" UUID NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "is_main" BOOLEAN NOT NULL DEFAULT false,
    "alt_text_ar" TEXT,
    "alt_text_en" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removed_at" TIMESTAMPTZ(3),

    CONSTRAINT "product_media_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "media_assets_object_key_key" ON "media_assets"("object_key");

-- CreateIndex
CREATE UNIQUE INDEX "media_assets_upload_token_hash_key" ON "media_assets"("upload_token_hash");

-- CreateIndex
CREATE INDEX "media_assets_created_by_employee_id_created_at_idx" ON "media_assets"("created_by_employee_id", "created_at");

-- CreateIndex
CREATE INDEX "product_media_product_id_sort_order_idx" ON "product_media"("product_id", "sort_order");

-- CreateIndex
CREATE INDEX "product_media_media_asset_id_idx" ON "product_media"("media_asset_id");

-- CreateIndex
CREATE INDEX "product_media_variant_id_idx" ON "product_media"("variant_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_media_one_main_key" ON "product_media"("product_id") WHERE (is_main AND removed_at IS NULL);

-- CreateIndex
CREATE UNIQUE INDEX "product_media_asset_once_key" ON "product_media"("product_id", "media_asset_id") WHERE (removed_at IS NULL);

-- AddForeignKey
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_created_by_employee_id_fkey" FOREIGN KEY ("created_by_employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_media" ADD CONSTRAINT "product_media_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_media" ADD CONSTRAINT "product_media_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_media" ADD CONSTRAINT "product_media_media_asset_id_fkey" FOREIGN KEY ("media_asset_id") REFERENCES "media_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A SAFE file has passed every check, so its measured details are known
-- (ADR-0021). Sizes are positive.
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_safe_complete_check"
  CHECK ("scan_status" <> 'SAFE' OR ("width" IS NOT NULL AND "height" IS NOT NULL
    AND "checksum" IS NOT NULL AND "completed_at" IS NOT NULL));
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_size_positive_check"
  CHECK ("size_bytes" > 0);

-- A removed image is never the main image; positions are not negative.
ALTER TABLE "product_media" ADD CONSTRAINT "product_media_removed_not_main_check"
  CHECK ("removed_at" IS NULL OR NOT "is_main");
ALTER TABLE "product_media" ADD CONSTRAINT "product_media_sort_order_check"
  CHECK ("sort_order" >= 0);

-- Uploaded files and product images are kept for history (orders keep a
-- picture of what was bought, Q184), never hard-deleted (ADR-0021).
CREATE TRIGGER "media_assets_no_delete"
BEFORE DELETE ON "media_assets"
FOR EACH ROW EXECUTE FUNCTION "catalog_reject_delete"();

CREATE TRIGGER "product_media_no_delete"
BEFORE DELETE ON "product_media"
FOR EACH ROW EXECUTE FUNCTION "catalog_reject_delete"();
