-- CreateEnum
CREATE TYPE "location_status" AS ENUM ('ACTIVE', 'INACTIVE');

-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "date_of_birth" DATE;

-- AlterTable
ALTER TABLE "otp_challenges" ADD COLUMN     "pending_value" TEXT;

-- CreateTable
CREATE TABLE "governorates" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name_ar" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "status" "location_status" NOT NULL DEFAULT 'ACTIVE',
    "sort_order" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "governorates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "areas" (
    "id" UUID NOT NULL,
    "governorate_id" UUID NOT NULL,
    "name_ar" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "status" "location_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "areas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_addresses" (
    "id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "label" TEXT,
    "recipient_name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "area_id" UUID NOT NULL,
    "city" TEXT,
    "street" TEXT NOT NULL,
    "building" TEXT,
    "floor" TEXT,
    "apartment" TEXT,
    "landmark" TEXT,
    "notes" TEXT,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_addresses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "governorates_code_key" ON "governorates"("code");

-- CreateIndex
CREATE UNIQUE INDEX "areas_governorate_id_name_ar_key" ON "areas"("governorate_id", "name_ar");

-- CreateIndex
CREATE UNIQUE INDEX "areas_governorate_id_name_en_key" ON "areas"("governorate_id", "name_en");

-- CreateIndex
CREATE INDEX "customer_addresses_customer_id_created_at_idx" ON "customer_addresses"("customer_id", "created_at");

-- CreateIndex
CREATE INDEX "customer_addresses_area_id_idx" ON "customer_addresses"("area_id");

-- CreateIndex
CREATE UNIQUE INDEX "customer_addresses_one_default_key" ON "customer_addresses"("customer_id") WHERE (is_default);

-- AddForeignKey
ALTER TABLE "areas" ADD CONSTRAINT "areas_governorate_id_fkey" FOREIGN KEY ("governorate_id") REFERENCES "governorates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_addresses" ADD CONSTRAINT "customer_addresses_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_addresses" ADD CONSTRAINT "customer_addresses_area_id_fkey" FOREIGN KEY ("area_id") REFERENCES "areas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Governorates and areas are deactivated, never deleted (R32, ADR-0030).
CREATE TRIGGER "governorates_no_delete"
BEFORE DELETE ON "governorates"
FOR EACH ROW EXECUTE FUNCTION "catalog_reject_delete"();

CREATE TRIGGER "areas_no_delete"
BEFORE DELETE ON "areas"
FOR EACH ROW EXECUTE FUNCTION "catalog_reject_delete"();

-- The 27 Egyptian governorates (ISO 3166-2:EG). Areas are added by the
-- Owner/Admin (R32).
INSERT INTO "governorates" ("id", "code", "name_ar", "name_en", "sort_order") VALUES
  (gen_random_uuid(), 'C', 'القاهرة', 'Cairo', 1),
  (gen_random_uuid(), 'GZ', 'الجيزة', 'Giza', 2),
  (gen_random_uuid(), 'ALX', 'الإسكندرية', 'Alexandria', 3),
  (gen_random_uuid(), 'KB', 'القليوبية', 'Qalyubia', 4),
  (gen_random_uuid(), 'SHR', 'الشرقية', 'Sharqia', 5),
  (gen_random_uuid(), 'DK', 'الدقهلية', 'Dakahlia', 6),
  (gen_random_uuid(), 'GH', 'الغربية', 'Gharbia', 7),
  (gen_random_uuid(), 'MNF', 'المنوفية', 'Monufia', 8),
  (gen_random_uuid(), 'BH', 'البحيرة', 'Beheira', 9),
  (gen_random_uuid(), 'KFS', 'كفر الشيخ', 'Kafr El Sheikh', 10),
  (gen_random_uuid(), 'DT', 'دمياط', 'Damietta', 11),
  (gen_random_uuid(), 'PTS', 'بورسعيد', 'Port Said', 12),
  (gen_random_uuid(), 'IS', 'الإسماعيلية', 'Ismailia', 13),
  (gen_random_uuid(), 'SUZ', 'السويس', 'Suez', 14),
  (gen_random_uuid(), 'FYM', 'الفيوم', 'Faiyum', 15),
  (gen_random_uuid(), 'BNS', 'بني سويف', 'Beni Suef', 16),
  (gen_random_uuid(), 'MN', 'المنيا', 'Minya', 17),
  (gen_random_uuid(), 'AST', 'أسيوط', 'Asyut', 18),
  (gen_random_uuid(), 'SHG', 'سوهاج', 'Sohag', 19),
  (gen_random_uuid(), 'KN', 'قنا', 'Qena', 20),
  (gen_random_uuid(), 'LX', 'الأقصر', 'Luxor', 21),
  (gen_random_uuid(), 'ASN', 'أسوان', 'Aswan', 22),
  (gen_random_uuid(), 'BA', 'البحر الأحمر', 'Red Sea', 23),
  (gen_random_uuid(), 'WAD', 'الوادي الجديد', 'New Valley', 24),
  (gen_random_uuid(), 'MT', 'مطروح', 'Matrouh', 25),
  (gen_random_uuid(), 'SIN', 'شمال سيناء', 'North Sinai', 26),
  (gen_random_uuid(), 'JS', 'جنوب سيناء', 'South Sinai', 27);
