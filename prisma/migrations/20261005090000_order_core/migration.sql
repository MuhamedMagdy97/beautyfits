-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "confirmed_at" TIMESTAMPTZ(3);

-- AddForeignKey
ALTER TABLE "inventory_reservations" ADD CONSTRAINT "inventory_reservations_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discount_usages" ADD CONSTRAINT "discount_usages_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_reservations" ADD CONSTRAINT "wallet_reservations_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written (TASK-030, ADR-0036): orders are historical facts (Q46, Q184,
-- DB Design §24). Orders and items are never deleted; items never change;
-- an order's commercial snapshot never changes. Lifecycle columns (status,
-- timestamps, wallet capture, proposed shipping company) stay writable, and
-- a guest order may be linked to an account once (customer_id NULL -> id).

CREATE FUNCTION "order_items_reject_change"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'order_items rows are immutable (% rejected)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER "order_items_immutable"
BEFORE UPDATE OR DELETE ON "order_items"
FOR EACH ROW EXECUTE FUNCTION "order_items_reject_change"();

CREATE FUNCTION "orders_reject_change"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'orders are never deleted'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (OLD."customer_id" IS NOT NULL AND NEW."customer_id" IS DISTINCT FROM OLD."customer_id")
     OR ROW(NEW."order_number", NEW."guest_email", NEW."guest_phone", NEW."payment_method",
            NEW."currency", NEW."locale", NEW."subtotal", NEW."discount_total",
            NEW."shipping_fee", NEW."total", NEW."wallet_amount_reserved", NEW."cod_amount",
            NEW."tax_included", NEW."tax_amount", NEW."tax_rate", NEW."applied_discount_id",
            NEW."discount_snapshot_json", NEW."shipping_rule_snapshot_json",
            NEW."shipping_address_snapshot_json", NEW."customer_snapshot_json", NEW."created_at")
        IS DISTINCT FROM
        ROW(OLD."order_number", OLD."guest_email", OLD."guest_phone", OLD."payment_method",
            OLD."currency", OLD."locale", OLD."subtotal", OLD."discount_total",
            OLD."shipping_fee", OLD."total", OLD."wallet_amount_reserved", OLD."cod_amount",
            OLD."tax_included", OLD."tax_amount", OLD."tax_rate", OLD."applied_discount_id",
            OLD."discount_snapshot_json", OLD."shipping_rule_snapshot_json",
            OLD."shipping_address_snapshot_json", OLD."customer_snapshot_json", OLD."created_at")
  THEN
    RAISE EXCEPTION 'order snapshots are immutable'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "orders_immutable"
BEFORE UPDATE OR DELETE ON "orders"
FOR EACH ROW EXECUTE FUNCTION "orders_reject_change"();
