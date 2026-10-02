-- CreateEnum
CREATE TYPE "supplier_status" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateTable
CREATE TABLE "suppliers" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "notes" TEXT,
    "status" "supplier_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "suppliers_status_name_idx" ON "suppliers"("status", "name");

-- Suppliers are deactivated, never hard-deleted (ADR-0026): purchases,
-- invoices and the supplier ledger keep pointing at them.
CREATE TRIGGER "suppliers_no_delete"
BEFORE DELETE ON "suppliers"
FOR EACH ROW EXECUTE FUNCTION "catalog_reject_delete"();
