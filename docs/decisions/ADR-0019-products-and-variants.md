# ADR-0019 — Products and variants

- **Status:** Accepted (TASK-014); the defaults in §4 confirmed by the product owner on 2026-10-01
- **Date:** 2026-10-01
- **Relates to:** ADR-0016 (permissions), ADR-0018 (audit logs); Business Spec C6, Q73–Q75, R14, R17, R19; User Flows §4.1; DB Design §5, §22 and "Variant canonicalization"; API Contract §13 and "TASK-014 Amendments"; permission catalog §1, §3

The catalog starts here. Later tasks hang brands and categories (TASK-015), media (TASK-016), the publishing lifecycle (TASK-017), prices and costs (TASK-018) and stock (TASK-019+) on the two tables this task adds.

## 1. Model

- `products` is the container customers see; `product_variants` is the canonical sellable unit (C6). Module `src/server/modules/catalog/`.
- **Every product has exactly one default variant.** `POST /admin/products` creates the product and its default variant in one transaction. A partial unique index allows at most one default per product, and a check constraint keeps the default `ACTIVE`, so the default can never be archived. The default moves with `PATCH /admin/variants/{id}` `{ "isDefault": true }`; the old and new default change in the same transaction under a lock on the product row.
- **Nothing is hard-deleted** (Q75, DB Design §5). A trigger rejects `DELETE` on both tables from any client. Variants are archived (`status = ARCHIVED`, `archived_at`); products are archived in TASK-017.
- **Status.** Products have `DRAFT | PUBLISHED | ARCHIVED | DISABLED` (User Flows §4.1); this task only creates `DRAFT` products and has no transition endpoint. Variants have `ACTIVE | ARCHIVED`.
- **Not in this task:** brand, categories, media, prices, costs, low-stock threshold, stock and public endpoints. Their columns are added by the tasks that own them, so no column exists before its rules do.
- **Doc conflict noted:** DB Design §22 lists "product SKU" as unique, while §5 (v1.2) says SKU is not a product field. This follows §5: only variants have a SKU.

## 2. Authorization and audit

- Permissions as in API §13: `PRODUCT_VIEW` to read, `PRODUCT_CREATE` to create products and add variants, `PRODUCT_EDIT` to edit content, `PRODUCT_ARCHIVE` to archive a variant. `PRODUCT_ARCHIVE` is in no default role, so Owner/Admin archive unless they grant it.
- Every change writes an audit entry in its transaction: `PRODUCT_CREATED`, `PRODUCT_UPDATED`, `PRODUCT_VARIANT_CREATED`, `PRODUCT_VARIANT_UPDATED`, `PRODUCT_VARIANT_ARCHIVED`, with the request id. An edit that changes nothing and a repeated archive write no entry.
- **No approval requests.** Business Spec R19 limits approvals in v1 to purchase orders, over-delivery extras, campaigns and critical settings, so product and variant changes apply immediately for whoever holds the permission.
- Clients cannot set status, default flags on create, prices or costs: unknown fields are ignored.

## 3. Concurrency

- SKU and slug uniqueness are checked first for a clear error and enforced by unique indexes; a race that loses at the index gets the same `409`.
- Adding a variant, moving the default and archiving lock the product row (`SELECT … FOR UPDATE`), so two simultaneous default moves leave exactly one default.

## 4. Defaults where the documents are silent (confirmed by the product owner, 2026-10-01)

1. **SKU format and case.** Staff type the SKU. 1–64 characters: letters, digits, and single `-`, `_` or `.` between them. Stored in capitals, so `lip-01` and `LIP-01` are the same SKU. Unique across all variants, archived ones included, so a SKU is never reused.
2. **SKUs can be corrected** while the variant is active. Past orders keep the SKU they were placed with (Q184 snapshot), so history is unaffected; the change is audited.
3. **Slug.** Optional when creating: made from the English name (`Matte Lipstick` → `matte-lipstick`). If that slug is taken, the request is refused (`409 SLUG_TAKEN`) rather than adding a number, so staff choose the address. A slug can change only while the product is a Draft, because links and search results point at it once customers can see it.
4. **Variant names** are optional and always come in pairs: Arabic and English together, or neither (R14). A simple product's default variant can stay unnamed. Whether every variant must be named before a product with several variants is published is left to TASK-017's publish checks.
5. **The default variant cannot be archived.** Make another variant the default first, or archive the whole product (TASK-017). So a product always keeps one sellable variant.
6. **Archiving a variant is final in v1** (no un-archive endpoint, like employee deactivation). An archived variant cannot be edited or made the default.
7. **Archived products cannot be changed** (no content edits, no variants added or edited). Disabled products can still be edited. TASK-017 may refine this when it adds the lifecycle.
8. **At most 100 variants per product** (technical guard; a product with more options than that is likely a data-entry error).
9. **Variant attributes** are an optional list of up to 20 name/value text pairs (for example `shade: Rose`, `size: 50 ml`), used by staff and filters later. They are not translated yet; customer-facing option labels come with the storefront tasks.

## Consequences

- New migration `products_variants` (two tables, two enums, the delete-rejecting trigger, check constraints).
- New audit action codes and entity types `PRODUCT`, `PRODUCT_VARIANT`.
- No new dependency.
