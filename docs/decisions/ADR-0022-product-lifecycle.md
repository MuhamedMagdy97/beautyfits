# ADR-0022 — Product publishing and archive lifecycle

- **Status:** Accepted (TASK-017); the decisions in §4 taken by the product owner on 2026-10-02
- **Date:** 2026-10-02
- **Relates to:** ADR-0016 (permissions), ADR-0018 (audit logs), ADR-0019 (products and variants, §4 items 3, 4, 7), ADR-0020 (§4 item 1), ADR-0021 (§5 item 6); Business Spec Q22, Q23, Q75, Q178, R18, R19; User Flows §4.1, §4.2; DB Design §5; API Contract §13 and "TASK-017 Amendments"; permission catalog §1, §3

## 1. States and transitions

| From \ To | `DRAFT` | `PUBLISHED` | `DISABLED` | `ARCHIVED` |
|---|---|---|---|---|
| `DRAFT` | — | publish | refused | archive |
| `PUBLISHED` | unpublish | — | disable | archive |
| `DISABLED` | unpublish | publish | — | archive |
| `ARCHIVED` | refused | refused | refused | — |

- **Endpoints** (API §13): `publish` and `unpublish` need `PRODUCT_PUBLISH`; `disable` and `archive` need `PRODUCT_ARCHIVE`. Neither permission is in a default role (R18), so Owner/Admin do this unless they grant it.
- **Repeating** a transition (publishing a published product, and so on) returns the product unchanged and writes no audit entry, like the variant archive.
- **Refused transitions** answer `409 CONFLICT`: `PRODUCT_ARCHIVED` from an archived product, `PRODUCT_STATUS_INVALID` (+ `status`) otherwise.
- **Logic** lives in `src/server/modules/catalog/lifecycle.ts` (pure: transition table and publish requirements) and `products-service.ts` (transactions). Every transition locks the product row, as variant and image changes already do, so a publish and a concurrent image removal or variant change run one after the other and each sees the other's result.

## 2. Publish requirements

Checked inside the publishing transaction, after the lock:

1. A current main image (Q178; ADR-0021 §5 item 6 already lets drafts have none).
2. When the product has more than one active variant, every active variant has its Arabic and English name (customers choose between them; ADR-0019 §4 item 4).

A refused publish answers `409 CONFLICT`, `details.reason = PUBLISH_REQUIREMENTS_NOT_MET`, `details.missing` listing every unmet requirement (`MAIN_IMAGE`, `VARIANT_NAMES` with `unnamedVariantIds`), so the dashboard can show them all at once. TASK-018 adds a selling price requirement here.

**Keeping a published product publishable.** While a product is `PUBLISHED`, changes that would make it fail these checks are refused: removing its last image (`MAIN_IMAGE_REQUIRED`, TASK-016), and adding a variant or clearing a variant name when that leaves more than one active variant with an unnamed one (`VARIANT_NAMES_REQUIRED`). Disabled and draft products may be edited freely; publishing them again re-checks.

## 3. Data

- New column `products.first_published_at`, set by the first publish and never cleared. It drives the slug lock (§4 item 3) and is returned as `firstPublishedAt`.
- Check constraints: `archived_at` is set exactly when the status is `ARCHIVED`; a `PUBLISHED` product has `first_published_at`.
- Trigger `products_archive_final`: an archived product's status can never change again, whoever writes the row.
- No status history table: the audit log holds every transition with its actor, reason and request id.
- Variants keep their own status when the product is archived: the default variant stays `ACTIVE` (its check constraint), and the product status alone decides whether anything is purchasable.

## 4. Decisions by the product owner (2026-10-02)

1. **Disabled is a pause, Archived is final.** A disabled product is hidden and not purchasable but can still be edited and published again. An archived product is retired: read-only (ADR-0019 §4 item 7), not purchasable, kept for history; there is no way back in v1.
2. **Publish needs** a main image and, with several active variants, names on all of them. A brand, categories and descriptions are not required (answers ADR-0019 §4 item 4 and ADR-0020 §4 item 1).
3. **The slug is locked once the product has ever been published**, also after it goes back to draft, so links and search results keep working (refines ADR-0019 §4 item 3).
4. **Images of archived products stay public** (User Flows §4.2: archived items may stay visible in wishlists, not purchasable). Draft and disabled products' images need a staff session.

## 5. Technical defaults

1. `disable` only from `PUBLISHED`: a draft is already invisible, so disabling it would mean nothing.
2. `unpublish` from `PUBLISHED` or `DISABLED`, back to `DRAFT`.
3. All four endpoints take an optional `reason` (max 1000 characters, blank means none), stored in the audit entry.

## Consequences

- Migration `product_lifecycle` (one column, two check constraints, one trigger).
- New audit action codes `PRODUCT_PUBLISHED`, `PRODUCT_UNPUBLISHED`, `PRODUCT_DISABLED`, `PRODUCT_ARCHIVED`.
- No new dependency.
