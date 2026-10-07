-- CreateEnum
CREATE TYPE "shipment_status" AS ENUM ('SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERY_FAILED', 'RETURN_TO_SENDER', 'RETURNED', 'DELIVERED');

-- CreateEnum
CREATE TYPE "shipment_event_type" AS ENUM ('SHIPPED', 'TRACKING_UPDATED', 'OUT_FOR_DELIVERY', 'DELIVERED');

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "delivered_at" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "shipments" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "shipping_company_id" UUID NOT NULL,
    "tracking_number" TEXT,
    "status" "shipment_status" NOT NULL DEFAULT 'SHIPPED',
    "picked_up_at" TIMESTAMPTZ(3) NOT NULL,
    "delivered_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "shipments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipment_events" (
    "id" UUID NOT NULL,
    "shipment_id" UUID NOT NULL,
    "event_type" "shipment_event_type" NOT NULL,
    "event_at" TIMESTAMPTZ(3) NOT NULL,
    "location" TEXT,
    "raw_provider_reference" TEXT,
    "notes" TEXT,

    CONSTRAINT "shipment_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "shipments_order_id_idx" ON "shipments"("order_id");

-- CreateIndex
CREATE INDEX "shipments_tracking_number_idx" ON "shipments"("tracking_number");

-- CreateIndex
CREATE UNIQUE INDEX "shipments_shipping_company_id_tracking_number_key" ON "shipments"("shipping_company_id", "tracking_number");

-- CreateIndex
CREATE INDEX "shipment_events_shipment_id_event_at_idx" ON "shipment_events"("shipment_id", "event_at");

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_shipping_company_id_fkey" FOREIGN KEY ("shipping_company_id") REFERENCES "shipping_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_events" ADD CONSTRAINT "shipment_events_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "shipments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Hand-written (TASK-034, ADR-0040).

-- A delivered shipment has its delivery time, and only then.
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_delivered_check"
    CHECK (("status" = 'DELIVERED') = ("delivered_at" IS NOT NULL));
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_tracking_number_check"
    CHECK ("tracking_number" IS NULL OR length(btrim("tracking_number")) > 0);

-- Shipments are part of the order's history: never deleted.
CREATE TRIGGER "shipments_no_delete"
BEFORE DELETE ON "shipments"
FOR EACH ROW EXECUTE FUNCTION "catalog_reject_delete"();

CREATE FUNCTION "shipment_events_reject_change"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'shipment_events rows are append-only (% rejected)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER "shipment_events_append_only"
BEFORE UPDATE OR DELETE ON "shipment_events"
FOR EACH ROW EXECUTE FUNCTION "shipment_events_reject_change"();
