# TASK-016 — Product Media & Secure Uploads

## Goal
Staff with `MANAGE_PRODUCT_MEDIA` can upload product images through the secure upload flow and attach, order, edit and remove them on products and variants. Every file is checked by the backend (type, size, dimensions, security) before it can be used; removed images are kept for history.

## Dependencies
TASK-014 (products, variants), TASK-012 (permissions), TASK-013 (audit log), TASK-004 (settings). Used by TASK-017 (publishing needs a main image, Q178), order snapshots (Q184), the storefront (TASK-058+), and later uploads for return evidence and supplier invoices (same flow).

## Source of Truth
- Business Spec Q175–Q178, Q184, R14, R19; User Flows §4.1
- Architecture §20 (file/media pipeline)
- DB Design §5 `product_media`, §6 `media_assets`, "v1.2 TASK-016 Amendments"
- API Contract §13, §28, "TASK-016 Amendments"
- Security Requirements §7; permission catalog §1 (`MANAGE_PRODUCT_MEDIA`), §3 (Catalog Editor)
- ADR-0021 (this task)

## Scope
- Tables `media_assets`, `product_media` (migration `product_media`) with check constraints, partial unique indexes (one main image, a file once per product) and delete-rejecting triggers.
- File storage port with a local-directory implementation (`MEDIA_DIR`), `src/server/storage/storage.ts`.
- Upload flow: `POST /files/upload-init`, `PUT /files/uploads/{id}`, `POST /files/complete`, `GET /files/{id}/content` (`src/server/modules/media/`).
- File checks: type from content, size, dimensions, structure (no appended data, no animation), built-in security scan.
- Product media service `src/server/modules/catalog/media-service.ts` and endpoints `POST /admin/products/{id}/media`, `PATCH`/`DELETE /admin/products/{id}/media/{mediaId}`, `PUT /admin/products/{id}/media/order`; images in product views, main image in product lists.
- Setting `catalog.max_images_per_product` (Q177).

## Non-Goals
- Publishing and its "needs a main image" check (TASK-017).
- Image resizing, re-encoding and metadata stripping (with the storefront, TASK-058+).
- A cloud storage provider and an antivirus service (open decisions before launch).
- Brand logos and category images; return evidence and supplier invoice uploads (their own tasks, same flow).
- Cleaning up abandoned pending uploads.

## Files / Modules
- `prisma/schema.prisma`, `prisma/migrations/20261001210448_product_media/`
- `src/server/storage/storage.ts`
- `src/server/modules/media/` (`image-inspection.ts`, `scanner.ts`, `schemas.ts`, `uploads-service.ts`)
- `src/server/modules/catalog/` (`media-service.ts`, `product-guards.ts`, `products-service.ts`, `schemas.ts`)
- `src/app/api/v1/files/**`, `src/app/api/v1/admin/products/[id]/media/**`
- `src/server/modules/settings/settings.ts`, `src/server/modules/audit/audit.ts`, `src/server/modules/auth/tokens.ts`, `src/server/config/env.ts`

## Business Rules
- Q175: a dedicated `MANAGE_PRODUCT_MEDIA` permission.
- Q176: backend validation of type, size, dimensions and security.
- Q177: the image limit is configurable.
- Q178: a published product cannot be without a main image.
- Q184 / no hard delete: removed images and their files are kept.
- R14: alt text in Arabic and English. R19: no approval requests.
- Defaults where the documents are silent: ADR-0021 §5 (listed under Open Items).

## API Changes
API Contract "TASK-016 Amendments".

## Database Changes
Migration `product_media`. DB Design "v1.2 TASK-016 Amendments".

## Security / Authorization
- `MANAGE_PRODUCT_MEDIA` to upload product images and change product media; `PRODUCT_VIEW` or `MANAGE_PRODUCT_MEDIA` to see unpublished images. Enforced server-side; cookie writes need the `Origin` check.
- Upload bytes are accepted only with the single-use token (hash stored), within 15 minutes, up to the declared size.
- Files are served with their checked type, `nosniff`, a sandbox CSP; only `SAFE` files are served or attached.
- Uploads are rate-limited per employee; every product media change is audited.

## Acceptance Criteria
- An image can be uploaded in three steps and is `SAFE` only after its content passes every check; refused files record the reason and their bytes are deleted.
- Images can be attached to a product or one of its active variants, edited, reordered and removed, each with an audit entry; a product with images always has exactly one main image.
- Removing an image keeps its record and file; nothing can be deleted in the database.
- A published product cannot lose its last image; archived products' images cannot change; the image limit comes from the setting.
- Each endpoint requires its permission; all required checks pass.

## Tests
- Unit `src/server/modules/media/media.test.ts`: type and dimensions of PNG, JPEG, WebP; refused types, truncated files, appended data, animations; the built-in scanner; the start-upload schema.
- Unit `src/server/storage/storage.test.ts`: store, replace, read, remove, size limit, keys outside the directory.
- Route tests `src/app/api/v1/admin/media-routes.int.test.ts`: the full upload flow, permissions and Origin check, token/content type/size/expiry guards, only the starter completes, each rejection reason, rate limit, attach/edit/reorder/remove with audit entries, main image rules, variant links, image limit, published and archived products, concurrent adds, serving rules.
- Bootstrap tests updated for the new setting.

## Edge Cases
- A file renamed to `.png` but containing a JPEG, HTML or a zip appended to a real picture: refused.
- Bytes resent after the upload was completed: refused; the checked file is unchanged.
- Two images added to an image-less product at the same moment: exactly one becomes main.
- The main image is removed: the next image becomes main. The last image of a published product cannot be removed.

## Definition of Done
Acceptance criteria met, docs updated, CI `verify` green, reviewed by the product owner.

## Open Items
Defaults where the documents are silent (ADR-0021 §5), awaiting the product owner's confirmation:
1. Files are stored in a local folder (`.media/`) until a storage provider is chosen before launch.
2. JPEG, PNG and WebP only.
3. At most 5 MB per file.
4. Images between 500 × 500 and 6000 × 6000 pixels.
5. At most 20 images per product (variant images included), changeable in settings.
6. A draft may have no image; publishing needs a main image (answers the DB Design §5 `[BUSINESS DECISION REQUIRED]`); a published product keeps at least one.
7. The first image becomes main; the next one takes over when the main image is removed.
8. Removed images are hidden, not deleted.
9. Built-in security checks for now; an antivirus service before launch.
10. Upload links last 15 minutes; refused files are deleted immediately.

Before launch: choose the storage provider and the antivirus service.

## Status
- [x] Planned
- [x] In Progress
- [x] Tests Passing
- [ ] Reviewed
- [ ] Done
