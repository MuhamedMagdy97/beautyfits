-- TASK-048: marketing campaigns and recipients (Q13, Q139, Q142, ADR-0061).

-- CreateEnum
CREATE TYPE "campaign_status" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SENDING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "campaign_recipient_status" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- CreateTable
CREATE TABLE "campaigns" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "channel" "marketing_channel" NOT NULL,
    "status" "campaign_status" NOT NULL DEFAULT 'DRAFT',
    "segment_json" JSONB NOT NULL,
    "subject" TEXT,
    "content" TEXT NOT NULL,
    "created_by_employee_id" UUID NOT NULL,
    "submitted_at" TIMESTAMPTZ(3),
    "approved_by_employee_id" UUID,
    "approved_at" TIMESTAMPTZ(3),
    "sent_by_employee_id" UUID,
    "sending_started_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_recipients" (
    "id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "channel" "marketing_channel" NOT NULL,
    "status" "campaign_recipient_status" NOT NULL DEFAULT 'PENDING',
    "eligibility_snapshot_json" JSONB NOT NULL,
    "sent_at" TIMESTAMPTZ(3),
    "failure_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "campaign_recipients_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "campaigns_status_created_at_idx" ON "campaigns"("status", "created_at");

-- CreateIndex
CREATE INDEX "campaign_recipients_campaign_id_status_idx" ON "campaign_recipients"("campaign_id", "status");

-- CreateIndex
CREATE INDEX "campaign_recipients_customer_id_created_at_idx" ON "campaign_recipients"("customer_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_recipients_campaign_id_customer_id_key" ON "campaign_recipients"("campaign_id", "customer_id");

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_created_by_employee_id_fkey" FOREIGN KEY ("created_by_employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_approved_by_employee_id_fkey" FOREIGN KEY ("approved_by_employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_sent_by_employee_id_fkey" FOREIGN KEY ("sent_by_employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written (TASK-048, ADR-0061).

-- The campaign's channel is always its segment's channel.
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_segment_channel_check"
  CHECK ("segment_json"->>'channel' = "channel"::text);

-- Campaigns and their recipients are history: never deleted.
CREATE FUNCTION "campaigns_reject_delete"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% rows cannot be deleted', TG_TABLE_NAME
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER "campaigns_no_delete"
BEFORE DELETE ON "campaigns"
FOR EACH ROW EXECUTE FUNCTION "campaigns_reject_delete"();

CREATE TRIGGER "campaign_recipients_no_delete"
BEFORE DELETE ON "campaign_recipients"
FOR EACH ROW EXECUTE FUNCTION "campaigns_reject_delete"();
