-- AlterTable
ALTER TABLE "return_items" ADD COLUMN     "deduction_amount" BIGINT,
ADD COLUMN     "refund_eligible_amount" BIGINT;

-- AlterTable
ALTER TABLE "returns" ADD COLUMN     "completed_at" TIMESTAMPTZ(3),
ADD COLUMN     "refund_total" BIGINT;

-- Hand-written (TASK-041, ADR-0068).
-- A completed return carries its fixed wallet refund and completion time;
-- no other return does.
ALTER TABLE "returns" ADD CONSTRAINT "returns_completion_check" CHECK (
  ("completed_at" IS NULL) = ("refund_total" IS NULL)
  AND ("completed_at" IS NOT NULL) = ("status" = 'COMPLETED')
  AND ("refund_total" IS NULL OR "refund_total" >= 0)
);
-- A line's refund and deduction are fixed together, at completion.
ALTER TABLE "return_items" ADD CONSTRAINT "return_items_refund_check" CHECK (
  ("refund_eligible_amount" IS NULL) = ("deduction_amount" IS NULL)
  AND ("refund_eligible_amount" IS NULL OR "refund_eligible_amount" >= 0)
  AND ("deduction_amount" IS NULL OR "deduction_amount" >= 0)
);
-- A return is refunded to the wallet at most once, whatever the code does.
CREATE UNIQUE INDEX "wallet_transactions_one_return_refund_key" ON "wallet_transactions"("reference_id") WHERE ("transaction_type" = 'RETURN_REFUND');
