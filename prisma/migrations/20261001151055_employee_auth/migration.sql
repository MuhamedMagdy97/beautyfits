-- CreateEnum
CREATE TYPE "employee_level" AS ENUM ('OWNER', 'ADMIN', 'MANAGER', 'EMPLOYEE');

-- CreateEnum
CREATE TYPE "employee_status" AS ENUM ('ACTIVE', 'DEACTIVATED');

-- CreateTable
CREATE TABLE "employees" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "display_name" TEXT NOT NULL,
    "employee_level" "employee_level" NOT NULL,
    "department" TEXT,
    "status" "employee_status" NOT NULL DEFAULT 'ACTIVE',
    "created_by_employee_id" UUID,
    "deactivated_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_trusted_devices" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "device_token_hash" TEXT NOT NULL,
    "verified_at" TIMESTAMPTZ(3) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "ip_address" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employee_trusted_devices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "employees_account_id_key" ON "employees"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "employee_trusted_devices_device_token_hash_key" ON "employee_trusted_devices"("device_token_hash");

-- CreateIndex
CREATE INDEX "employee_trusted_devices_account_id_idx" ON "employee_trusted_devices"("account_id");

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_created_by_employee_id_fkey" FOREIGN KEY ("created_by_employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_trusted_devices" ADD CONSTRAINT "employee_trusted_devices_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
