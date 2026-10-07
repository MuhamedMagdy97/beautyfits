-- CreateEnum
CREATE TYPE "analytics_event_type" AS ENUM ('PRODUCT_VIEW', 'ADD_TO_CART', 'CHECKOUT_STARTED', 'CHECKOUT_ABANDONED', 'ORDER_CREATED');

-- CreateTable
CREATE TABLE "analytics_events" (
    "id" UUID NOT NULL,
    "anonymous_id" UUID,
    "customer_id" UUID,
    "event_type" "analytics_event_type" NOT NULL,
    "entity_type" TEXT,
    "entity_id" UUID,
    "metadata_json" JSONB NOT NULL DEFAULT '{}',
    "dedupe_key" TEXT,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "analytics_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "analytics_events_dedupe_key_key" ON "analytics_events"("dedupe_key");

-- CreateIndex
CREATE INDEX "analytics_events_event_type_occurred_at_idx" ON "analytics_events"("event_type", "occurred_at");

-- CreateIndex
CREATE INDEX "analytics_events_entity_id_event_type_occurred_at_idx" ON "analytics_events"("entity_id", "event_type", "occurred_at");
