-- TASK-049: campaign delivery, frequency limits, retries and fallback (Q143, Q144, ADR-0067).

-- CreateEnum
CREATE TYPE "campaign_skip_reason" AS ENUM ('CONSENT_WITHDRAWN', 'FREQUENCY_LIMIT', 'NO_ADDRESS');

-- AlterEnum
ALTER TYPE "campaign_recipient_status" ADD VALUE 'SKIPPED';
ALTER TYPE "campaign_recipient_status" ADD VALUE 'FALLBACK_SENT';

-- AlterTable
ALTER TABLE "campaign_recipients" ADD COLUMN     "attempt_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "next_attempt_at" TIMESTAMPTZ(3),
ADD COLUMN     "skip_reason" "campaign_skip_reason";

-- AlterTable
ALTER TABLE "notification_deliveries" ADD COLUMN     "campaign_recipient_id" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "notification_deliveries_campaign_recipient_id_attempt_numbe_key" ON "notification_deliveries"("campaign_recipient_id", "attempt_number");

-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_campaign_recipient_id_fkey" FOREIGN KEY ("campaign_recipient_id") REFERENCES "campaign_recipients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
