-- AlterTable
ALTER TABLE "product_variants" ADD COLUMN     "currency" CHAR(3) NOT NULL DEFAULT 'EGP',
ADD COLUMN     "first_goods_receipt_at" TIMESTAMPTZ(3),
ADD COLUMN     "latest_purchase_cost" BIGINT,
ADD COLUMN     "selling_price" BIGINT,
ADD COLUMN     "weighted_average_cost" BIGINT;

-- Money is integer piastres (ADR-0011). A selling price is positive (ADR-0023
-- §4 item 5); costs are never negative. EGP is the only currency.
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_selling_price_check"
  CHECK ("selling_price" IS NULL OR "selling_price" > 0);
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_costs_check"
  CHECK (("latest_purchase_cost" IS NULL OR "latest_purchase_cost" >= 0)
     AND ("weighted_average_cost" IS NULL OR "weighted_average_cost" >= 0));
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_currency_check"
  CHECK ("currency" = 'EGP');

-- Once set, a selling price is never cleared (ADR-0023 §4 item 5), whoever
-- writes the row.
CREATE FUNCTION "product_variants_price_kept"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'a selling price cannot be cleared'
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER "product_variants_price_kept"
BEFORE UPDATE OF "selling_price" ON "product_variants"
FOR EACH ROW
WHEN (OLD."selling_price" IS NOT NULL AND NEW."selling_price" IS NULL)
EXECUTE FUNCTION "product_variants_price_kept"();
