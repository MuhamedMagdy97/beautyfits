-- CreateEnum
CREATE TYPE "setting_data_type" AS ENUM ('INTEGER', 'BOOLEAN', 'STRING', 'JSON');

-- CreateTable
CREATE TABLE "settings" (
    "key" TEXT NOT NULL,
    "value_json" JSONB NOT NULL,
    "data_type" "setting_data_type" NOT NULL,
    "updated_by_employee_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("key")
);

-- AddForeignKey
ALTER TABLE "settings" ADD CONSTRAINT "settings_updated_by_employee_id_fkey" FOREIGN KEY ("updated_by_employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;
