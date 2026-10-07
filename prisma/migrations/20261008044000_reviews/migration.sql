-- CreateEnum
CREATE TYPE "review_status" AS ENUM ('PUBLISHED', 'HIDDEN');

-- CreateTable
CREATE TABLE "reviews" (
    "id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "order_item_id" UUID NOT NULL,
    "rating" INTEGER NOT NULL,
    "body" TEXT NOT NULL,
    "status" "review_status" NOT NULL DEFAULT 'PUBLISHED',
    "moderation_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_moderation_history" (
    "id" UUID NOT NULL,
    "review_id" UUID NOT NULL,
    "from_status" "review_status" NOT NULL,
    "to_status" "review_status" NOT NULL,
    "employee_id" UUID NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "review_moderation_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_reports" (
    "id" UUID NOT NULL,
    "review_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "resolved_at" TIMESTAMPTZ(3),

    CONSTRAINT "review_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reviews_product_id_status_created_at_idx" ON "reviews"("product_id", "status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "reviews_status_created_at_idx" ON "reviews"("status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "reviews_customer_id_idx" ON "reviews"("customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "reviews_order_id_product_id_key" ON "reviews"("order_id", "product_id");

-- CreateIndex
CREATE INDEX "review_moderation_history_review_id_created_at_idx" ON "review_moderation_history"("review_id", "created_at");

-- CreateIndex
CREATE INDEX "review_reports_review_id_resolved_at_idx" ON "review_reports"("review_id", "resolved_at");

-- CreateIndex
CREATE UNIQUE INDEX "review_reports_review_id_customer_id_key" ON "review_reports"("review_id", "customer_id");

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_moderation_history" ADD CONSTRAINT "review_moderation_history_review_id_fkey" FOREIGN KEY ("review_id") REFERENCES "reviews"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_moderation_history" ADD CONSTRAINT "review_moderation_history_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_reports" ADD CONSTRAINT "review_reports_review_id_fkey" FOREIGN KEY ("review_id") REFERENCES "reviews"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_reports" ADD CONSTRAINT "review_reports_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written (TASK-044, ADR-0042): rating 1-5 plus written text (Q171).
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_rating_check" CHECK ("rating" BETWEEN 1 AND 5);
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_body_check" CHECK (btrim("body") <> '');

-- Reviews and reports are hidden or resolved, never deleted; moderation
-- history is append-only (Q174). TRUNCATE (integration test reset only)
-- does not fire row triggers.
CREATE FUNCTION "reviews_reject_change"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% rows keep their history (% rejected)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER "reviews_no_delete"
BEFORE DELETE ON "reviews"
FOR EACH ROW EXECUTE FUNCTION "reviews_reject_change"();

CREATE TRIGGER "review_reports_no_delete"
BEFORE DELETE ON "review_reports"
FOR EACH ROW EXECUTE FUNCTION "reviews_reject_change"();

CREATE TRIGGER "review_moderation_history_append_only"
BEFORE UPDATE OR DELETE ON "review_moderation_history"
FOR EACH ROW EXECUTE FUNCTION "reviews_reject_change"();

