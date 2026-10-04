-- CreateEnum
CREATE TYPE "wallet_transaction_type" AS ENUM ('MANUAL_ADJUSTMENT', 'ORDER_WALLET_USE', 'RETURN_REFUND');

-- CreateEnum
CREATE TYPE "wallet_direction" AS ENUM ('CREDIT', 'DEBIT');

-- CreateEnum
CREATE TYPE "wallet_reservation_status" AS ENUM ('ACTIVE', 'CAPTURED', 'RELEASED');

-- CreateTable
CREATE TABLE "wallets" (
    "id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'EGP',
    "balance" BIGINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallet_transactions" (
    "id" UUID NOT NULL,
    "wallet_id" UUID NOT NULL,
    "transaction_type" "wallet_transaction_type" NOT NULL,
    "direction" "wallet_direction" NOT NULL,
    "amount" BIGINT NOT NULL,
    "reference_type" TEXT,
    "reference_id" UUID,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallet_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallet_reservations" (
    "id" UUID NOT NULL,
    "wallet_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "amount" BIGINT NOT NULL,
    "status" "wallet_reservation_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "released_at" TIMESTAMPTZ(3),
    "captured_at" TIMESTAMPTZ(3),

    CONSTRAINT "wallet_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "wallets_customer_id_key" ON "wallets"("customer_id");

-- CreateIndex
CREATE INDEX "wallet_transactions_wallet_id_created_at_idx" ON "wallet_transactions"("wallet_id", "created_at");

-- CreateIndex
CREATE INDEX "wallet_transactions_reference_type_reference_id_idx" ON "wallet_transactions"("reference_type", "reference_id");

-- CreateIndex
CREATE INDEX "wallet_reservations_wallet_id_status_idx" ON "wallet_reservations"("wallet_id", "status");

-- CreateIndex
CREATE INDEX "wallet_reservations_order_id_idx" ON "wallet_reservations"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "wallet_reservations_one_active_key" ON "wallet_reservations"("order_id") WHERE (status = 'ACTIVE');

-- AddForeignKey
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_reservations" ADD CONSTRAINT "wallet_reservations_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written (TASK-028, ADR-0034): the ledger is the only way to change a
-- balance, it is append-only, and a balance never goes below zero.

ALTER TABLE "wallets" ADD CONSTRAINT "wallets_balance_check" CHECK ("balance" >= 0);

ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_amount_check"
    CHECK ("amount" > 0);

ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_reference_check"
    CHECK (("reference_type" IS NULL) = ("reference_id" IS NULL));

ALTER TABLE "wallet_reservations" ADD CONSTRAINT "wallet_reservations_amount_check"
    CHECK ("amount" > 0);

ALTER TABLE "wallet_reservations" ADD CONSTRAINT "wallet_reservations_status_check"
    CHECK (("status" = 'ACTIVE' AND "released_at" IS NULL AND "captured_at" IS NULL)
        OR ("status" = 'RELEASED' AND "released_at" IS NOT NULL AND "captured_at" IS NULL)
        OR ("status" = 'CAPTURED' AND "captured_at" IS NOT NULL AND "released_at" IS NULL));

CREATE FUNCTION "wallet_transactions_apply"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "wallets" SET
    "balance" = "balance" + CASE NEW."direction" WHEN 'CREDIT' THEN NEW."amount" ELSE -NEW."amount" END,
    "updated_at" = NEW."created_at"
  WHERE "id" = NEW."wallet_id";
  RETURN NULL;
END;
$$;

CREATE TRIGGER "wallet_transactions_apply"
AFTER INSERT ON "wallet_transactions"
FOR EACH ROW EXECUTE FUNCTION "wallet_transactions_apply"();

CREATE FUNCTION "wallet_transactions_reject_change"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'wallet_transactions rows are append-only (% rejected)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER "wallet_transactions_append_only"
BEFORE UPDATE OR DELETE ON "wallet_transactions"
FOR EACH ROW EXECUTE FUNCTION "wallet_transactions_reject_change"();

CREATE FUNCTION "wallets_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."balance" <> 0 THEN
      RAISE EXCEPTION 'a wallet starts empty; credit it through wallet_transactions'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' OR pg_trigger_depth() < 2 THEN
    RAISE EXCEPTION 'wallets change only through wallet_transactions (% rejected)', TG_OP
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "wallets_guard"
BEFORE INSERT OR UPDATE OR DELETE ON "wallets"
FOR EACH ROW EXECUTE FUNCTION "wallets_guard"();
