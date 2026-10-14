-- CreateTable
CREATE TABLE "setting_history" (
    "id" UUID NOT NULL,
    "setting_key" TEXT NOT NULL,
    "old_value_json" JSONB,
    "new_value_json" JSONB NOT NULL,
    "changed_by_employee_id" UUID NOT NULL,
    "approved_by_employee_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "setting_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "setting_history_setting_key_created_at_idx" ON "setting_history"("setting_key", "created_at" DESC);

-- CreateIndex
CREATE INDEX "setting_history_created_at_idx" ON "setting_history"("created_at" DESC);

-- AddForeignKey
ALTER TABLE "setting_history" ADD CONSTRAINT "setting_history_changed_by_employee_id_fkey" FOREIGN KEY ("changed_by_employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "setting_history" ADD CONSTRAINT "setting_history_approved_by_employee_id_fkey" FOREIGN KEY ("approved_by_employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;
