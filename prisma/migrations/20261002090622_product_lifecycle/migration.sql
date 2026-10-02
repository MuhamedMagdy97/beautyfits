-- AlterTable
ALTER TABLE "products" ADD COLUMN     "first_published_at" TIMESTAMPTZ(3);

-- An archived product has archived_at, and only an archived one (ADR-0022 §3).
ALTER TABLE "products" ADD CONSTRAINT "products_archived_at_check"
  CHECK (("status" = 'ARCHIVED') = ("archived_at" IS NOT NULL));

-- A published product has been published at least once (ADR-0022 §3).
ALTER TABLE "products" ADD CONSTRAINT "products_first_published_check"
  CHECK ("status" <> 'PUBLISHED' OR "first_published_at" IS NOT NULL);

-- Archiving a product is final in v1 (ADR-0022 §4 item 1): its status never
-- changes again, whoever writes the row.
CREATE FUNCTION "products_archive_final"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'archived products cannot change status'
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER "products_archive_final"
BEFORE UPDATE OF "status" ON "products"
FOR EACH ROW
WHEN (OLD."status" = 'ARCHIVED' AND NEW."status" IS DISTINCT FROM 'ARCHIVED')
EXECUTE FUNCTION "products_archive_final"();
