-- CreateEnum
CREATE TYPE "otp_purpose" AS ENUM ('EMAIL_VERIFICATION', 'PASSWORD_RESET', 'EMPLOYEE_LOGIN', 'EMAIL_CHANGE', 'PHONE_CHANGE', 'PHONE_VERIFICATION', 'GUEST_ORDER_CLAIM');

-- CreateEnum
CREATE TYPE "otp_channel" AS ENUM ('EMAIL', 'WHATSAPP');

-- CreateTable
CREATE TABLE "otp_challenges" (
    "id" UUID NOT NULL,
    "account_id" UUID,
    "purpose" "otp_purpose" NOT NULL,
    "channel" "otp_channel" NOT NULL,
    "destination" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "last_sent_at" TIMESTAMPTZ(3) NOT NULL,
    "consumed_at" TIMESTAMPTZ(3),
    "superseded_at" TIMESTAMPTZ(3),
    "grant_token_hash" TEXT,
    "grant_expires_at" TIMESTAMPTZ(3),
    "grant_used_at" TIMESTAMPTZ(3),
    "ip_address" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "otp_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "otp_challenges_grant_token_hash_key" ON "otp_challenges"("grant_token_hash");

-- CreateIndex
CREATE INDEX "otp_challenges_purpose_destination_created_at_idx" ON "otp_challenges"("purpose", "destination", "created_at");

-- CreateIndex
CREATE INDEX "otp_challenges_account_id_idx" ON "otp_challenges"("account_id");

-- AddForeignKey
ALTER TABLE "otp_challenges" ADD CONSTRAINT "otp_challenges_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
