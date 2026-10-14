-- TASK-046: marketing consent ledger (Q59, Q60, ADR-0051).

-- CreateEnum
CREATE TYPE "marketing_channel" AS ENUM ('EMAIL', 'WHATSAPP');

-- CreateEnum
CREATE TYPE "marketing_consent_status" AS ENUM ('OPTED_IN', 'OPTED_OUT');

-- CreateEnum
CREATE TYPE "consent_purpose" AS ENUM ('MARKETING');

-- CreateEnum
CREATE TYPE "marketing_consent_source" AS ENUM ('CUSTOMER_ACCOUNT', 'ACCOUNT_DEACTIVATED');

-- CreateTable
CREATE TABLE "marketing_consents" (
    "id" BIGSERIAL NOT NULL,
    "customer_id" UUID NOT NULL,
    "channel" "marketing_channel" NOT NULL,
    "purpose" "consent_purpose" NOT NULL DEFAULT 'MARKETING',
    "status" "marketing_consent_status" NOT NULL,
    "source" "marketing_consent_source" NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "marketing_consents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "marketing_consents_customer_id_channel_id_idx" ON "marketing_consents"("customer_id", "channel", "id");

-- AddForeignKey
ALTER TABLE "marketing_consents" ADD CONSTRAINT "marketing_consents_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Consent history is append-only: a change is a new row, never an edit.
CREATE FUNCTION "marketing_consents_reject_change"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'marketing_consents rows are append-only (% rejected)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER "marketing_consents_append_only"
BEFORE UPDATE OR DELETE ON "marketing_consents"
FOR EACH ROW EXECUTE FUNCTION "marketing_consents_reject_change"();
