# ADR-0026 — Suppliers

- **Status:** Accepted (TASK-021); the defaults in §2 await the product owner's confirmation
- **Date:** 2026-10-03
- **Relates to:** ADR-0020 (brands and categories, same pattern), ADR-0013 (audit); Business Spec Q112; DB Design §11 and "v1.2 TASK-021 Amendments"; API Contract §21 and "TASK-021 Amendments"; permission catalog (`SUPPLIER_VIEW`, `SUPPLIER_MANAGE`)

## 1. Design

- Table `suppliers` (DB Design §11): `name`, `phone`, `email`, `address`, `notes`, `status`, timestamps.
- `GET /admin/suppliers` (`SUPPLIER_VIEW`), `POST /admin/suppliers` and `PATCH /admin/suppliers/{id}` (`SUPPLIER_MANAGE`), served by `src/server/modules/suppliers/`.
- Every create and change writes an audit entry (`SUPPLIER_CREATED`, `SUPPLIER_UPDATED`, entity `SUPPLIER`) in its transaction.
- Suppliers are never deleted: a trigger rejects `DELETE`, so purchases, invoices and the supplier ledger (TASK-022–024) always find their supplier.

## 2. Technical defaults (owner to confirm)

1. **Status:** `ACTIVE` / `INACTIVE`. Deactivating stops new purchase orders (enforced by TASK-022); existing purchases, receipts, returns and payments go on. Reactivating is allowed.
2. **Contacts:** one set of contact details per supplier (phone, email, address); `notes` holds anything else (contact person, payment terms). Phone accepts landlines and international numbers.
3. **Names:** unique ignoring case (`409 CONFLICT`, `NAME_TAKEN`), so the purchase screens never show two suppliers with the same name. Checked in the service, not by an index.
4. **Approval:** none for supplier changes; the `SUPPLIER_MANAGE` permission and the audit entry are the control (as for brands, R19).

## Consequences

- Migration `suppliers` (one table, one enum, one trigger reusing `catalog_reject_delete`).
- TASK-022 adds `purchase_orders.supplier_id` (foreign key, `RESTRICT`) and refuses new orders for `INACTIVE` suppliers, locking the supplier row (`FOR SHARE`) against a concurrent deactivation (this task's update takes `FOR UPDATE`).
- No new dependency.
