-- CreateEnum
CREATE TYPE "shipping_status" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateTable
CREATE TABLE "shipping_companies" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contact_info" TEXT,
    "status" "shipping_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shipping_companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipping_rules" (
    "id" UUID NOT NULL,
    "shipping_company_id" UUID,
    "governorate_id" UUID,
    "area_id" UUID,
    "min_order_total" BIGINT,
    "max_order_total" BIGINT,
    "shipping_fee" BIGINT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "active_from" TIMESTAMPTZ(3),
    "active_to" TIMESTAMPTZ(3),
    "status" "shipping_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shipping_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "shipping_companies_code_key" ON "shipping_companies"("code");

-- CreateIndex
CREATE INDEX "shipping_rules_status_idx" ON "shipping_rules"("status");

-- AddForeignKey
ALTER TABLE "shipping_rules" ADD CONSTRAINT "shipping_rules_shipping_company_id_fkey" FOREIGN KEY ("shipping_company_id") REFERENCES "shipping_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipping_rules" ADD CONSTRAINT "shipping_rules_governorate_id_fkey" FOREIGN KEY ("governorate_id") REFERENCES "governorates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipping_rules" ADD CONSTRAINT "shipping_rules_area_id_fkey" FOREIGN KEY ("area_id") REFERENCES "areas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Companies and rules are never deleted: deactivated instead (orders keep a snapshot).
CREATE TRIGGER "shipping_companies_no_delete"
BEFORE DELETE ON "shipping_companies"
FOR EACH ROW EXECUTE FUNCTION "catalog_reject_delete"();

CREATE TRIGGER "shipping_rules_no_delete"
BEFORE DELETE ON "shipping_rules"
FOR EACH ROW EXECUTE FUNCTION "catalog_reject_delete"();

ALTER TABLE "shipping_companies" ADD CONSTRAINT "shipping_companies_code_upper_check"
    CHECK ("code" = upper("code"));
ALTER TABLE "shipping_rules" ADD CONSTRAINT "shipping_rules_amounts_check"
    CHECK ("shipping_fee" >= 0
       AND ("min_order_total" IS NULL OR "min_order_total" >= 0)
       AND ("max_order_total" IS NULL OR "max_order_total" > COALESCE("min_order_total", 0)));
ALTER TABLE "shipping_rules" ADD CONSTRAINT "shipping_rules_period_check"
    CHECK ("active_to" IS NULL OR "active_from" IS NULL OR "active_to" > "active_from");
ALTER TABLE "shipping_rules" ADD CONSTRAINT "shipping_rules_area_governorate_check"
    CHECK ("area_id" IS NULL OR "governorate_id" IS NOT NULL);
