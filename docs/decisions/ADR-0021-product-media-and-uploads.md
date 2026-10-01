# ADR-0021 — Product media and secure uploads

- **Status:** Accepted (TASK-016); the defaults in §5 await confirmation by the product owner
- **Date:** 2026-10-01
- **Relates to:** ADR-0014 (local email transport, the same "local until a provider is chosen" pattern), ADR-0016 (permissions), ADR-0017 (settings), ADR-0018 (audit logs), ADR-0019 (products and variants); Business Spec Q175–Q178, Q184, R19; User Flows §4.1; Architecture §20; DB Design §5 "product_media", §6 "media_assets"; API Contract §13, §28 and "TASK-016 Amendments"; Security Requirements §7; permission catalog §1, §3

## 1. Upload flow (API §28)

Every file enters through the one upload flow of API §28, so product images now and supplier invoices and return evidence later share the same checks.

1. `POST /files/upload-init` `{ purpose, filename, mimeType, sizeBytes }`. The declared type, size and file name are checked first. A `media_assets` row is created as `PENDING` with a server-generated object key, and the response carries a **short-lived, single-use upload authorization**: a `PUT` URL and the headers to send with it (`Content-Type` and `X-Upload-Token`). Only the SHA-256 of the token is stored. The authorization is valid for 15 minutes.
2. The client sends the bytes to that URL. For the local storage this is `PUT /files/uploads/{id}`, authorized by the token (like an object storage upload link), not by a session. More bytes than declared are refused. The bytes wait under a staging key.
3. `POST /files/complete` `{ mediaAssetId }`. The stored file itself is checked (§3). It becomes `SAFE` and is moved to its object key, or `REJECTED` with the reason and its bytes are deleted. Only the employee who started an upload can complete it; completing again returns the same result.

Only `SAFE` files can be attached to products or served. A late resend after completion cannot replace a checked file: the token is cleared on completion, and resent bytes only ever land in staging.

## 2. Storage

- Callers use the `FileStorage` port (`src/server/storage/storage.ts`). The only implementation stores files in a local directory, `MEDIA_DIR` (default `.media/`, git-ignored), because the store runs locally for now. An object storage provider replaces it later without changing callers: its `upload-init` returns the provider's upload link instead of the local `PUT` URL. **The provider is an open decision before launch.**
- Object keys are generated (`product-media/<random uuid>.<ext>`), never derived from the uploaded name; the storage refuses any key that could leave its directory. Binary data never goes into PostgreSQL (DB §6).
- Files are written to a temporary name and renamed when complete, so a reader never sees a partial file.

## 3. File checks (Q176: type, size, dimensions, security)

The backend checks every file; nothing from the client is trusted (Q176).

- **Type from content.** The file signature decides the type; it must be JPEG, PNG or WebP and match the declared type and the file name's extension. SVG (which can carry script), GIF, HEIC and everything else are refused.
- **Size.** At most 5 MB, checked when declared, while receiving and on completion.
- **Dimensions.** Read from the image header: at least 500 × 500 and at most 6000 × 6000 pixels. The picture is never decoded, so a "decompression bomb" costs nothing.
- **Structure.** The whole file is walked (PNG chunks, JPEG segments, RIFF chunks). Truncated files, animations and **data appended after the end of the image** (a common way to hide another file inside a picture) are refused.
- **Security scan.** The `MalwareScanner` port (`src/server/modules/media/scanner.ts`). The built-in scanner refuses files that contain markup or script markers (`<script`, `<?php`, `<svg`, `javascript:` …). Together with the structure check this is the v1 security validation. **An antivirus service is an open decision before launch**; it plugs into the same port.
- **Serving.** `GET /files/{id}/content` sends only `SAFE` files, with their checked type, `X-Content-Type-Options: nosniff`, a `sandbox` content security policy and an `ETag`. Images of published products are public (cacheable); everything else needs a staff session with `PRODUCT_VIEW` or `MANAGE_PRODUCT_MEDIA`.
- **Not done yet:** images are stored as uploaded. Re-encoding (which would also strip camera metadata such as GPS location) and resized copies for the storefront need an image library and come with the storefront tasks (TASK-058+), recorded as a follow-up.

## 4. Product media

- `product_media` links a `SAFE` product image to a product, optionally to one of its active variants, with a position (`sort_order`), `is_main` and alt text in Arabic and English (R14). Endpoints: `POST /admin/products/{id}/media`, `PATCH` and `DELETE /admin/products/{id}/media/{mediaId}`, `PUT /admin/products/{id}/media/order`. The product view lists its current images; the product list shows the main image.
- **One main image.** A partial unique index allows at most one current main image per product. The first image becomes main; `isMain: true` moves it; removing the main image makes the first remaining image main.
- **Archival behavior.** Removing an image sets `removed_at`; the row, the file and the `media_assets` row stay, so order history (Q184 "image snapshot at purchase") and audit entries can still show it. A trigger rejects `DELETE` on both tables. Archived products' images no longer change (`PRODUCT_ARCHIVED`); images of archived variants stay.
- **Permissions (Q175).** `MANAGE_PRODUCT_MEDIA` to upload product images and to add, edit, reorder and remove them; `PRODUCT_EDIT` alone is not enough. The Catalog Editor default role already has it.
- **Audit.** `PRODUCT_MEDIA_ADDED`, `PRODUCT_MEDIA_UPDATED`, `PRODUCT_MEDIA_REMOVED` (entity type `PRODUCT_MEDIA`) and `PRODUCT_MEDIA_REORDERED` (entity type `PRODUCT`), in the same transaction, with the request id. A change that changes nothing writes no entry. Uploads themselves are logged (started, received, completed, rejected with the reason), not audited: a file does nothing until it is attached. No approval requests (R19).
- **Concurrency.** Every product image change locks the product row (as variant changes do), so two images added at once still give one main image and consecutive positions.
- **Abuse guard.** One employee can start at most 300 uploads per hour (`429 RATE_LIMITED`, PostgreSQL buckets of ADR-0013).

## 5. Defaults where the documents are silent (awaiting the product owner's confirmation)

1. **Storage:** files are kept in a local folder (`.media/`) until a storage provider is chosen before launch, like emails in `.mail/`.
2. **Accepted types:** JPEG, PNG and WebP only.
3. **Largest file:** 5 MB.
4. **Image size:** at least 500 × 500 and at most 6000 × 6000 pixels.
5. **Images per product:** at most 20, counting variant images (Q177 "configurable": setting `catalog.max_images_per_product`, changeable later from the settings screen, TASK-057).
6. **Drafts may have no image.** A product can be created and edited without images; publishing requires a main image (Q178, checked by TASK-017). This answers the DB Design §5 `[BUSINESS DECISION REQUIRED]` "whether a Draft may exist without one": images are uploaded after the product is created, so a brand-new draft has none. A **published** product can never lose its last image (`409 MAIN_IMAGE_REQUIRED`).
7. **Main image:** the first image becomes main automatically, and the next image takes over when the main one is removed.
8. **Removed images are hidden, not deleted:** the file and record are kept for order history and audit.
9. **Security scan:** built-in checks for now (real image content, nothing hidden after the image, no script); an antivirus service is chosen before launch.
10. **Upload links last 15 minutes;** refused files are deleted immediately.

## Consequences

- New migration `product_media` (tables `media_assets`, `product_media`, enums `media_scan_status`, `media_purpose`, check constraints, delete triggers).
- New environment variable `MEDIA_DIR`, new setting `catalog.max_images_per_product` (inserted by `npm run db:seed`), new token kind `upload` (`bfu_`).
- New audit action codes and the entity type `PRODUCT_MEDIA`.
- No new dependency: image headers are read by `src/server/modules/media/image-inspection.ts`.
- Brand logos and category images (mentioned in ADR-0020) are not part of this task: the DB design has no column for them yet. They can use the same upload flow when the storefront needs them.
- Open before launch: the storage provider and an antivirus service.
