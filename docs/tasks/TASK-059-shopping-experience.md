# TASK-059 — Customer Shopping Experience Integration

## Goal
Customers browse, search and view products, manage the bag, check out with cash on delivery (guest or signed in), and manage their profile, addresses and wishlist on the website, in Arabic (RTL) and English. The public catalog endpoints of API §13 are implemented for it.

## Dependencies
TASK-058 (storefront shell, ADR-0055). Uses TASK-009 (profile, addresses, locations), TASK-014–018 (catalog data), TASK-025–029 (cart, discounts, shipping, wallet, checkout), TASK-042–044 (wishlist, restock, reviews), TASK-050 (analytics events). Followed by TASK-060 (orders, returns, wallet screens).

## Source of Truth
- Business Spec Q4, Q20, Q37, Q38, Q45–Q48, Q138, Q146, R14, R16, R32, R36–R39, C1
- User Flows §5, §6.1–§6.4
- API Contract §11, §13, §14, §15, §19, §20 and "TASK-009/025/026/027/029/042/043/044/050 Amendments"; "TASK-059 Amendments" (this task)
- Design reference: `design-reference/google-stitch/beautyfits_shop_all_products`, `beautyfits_product_details_ysl_libre_edp`, `beautyfits_shopping_bag_cart`, `beautyfits_checkout_cash_on_delivery`, `beautyfits_order_confirmation_cod_pending`, `beautyfits_account_orders_wallet`
- ADR-0055, ADR-0059 (this task)

## Scope
- API: `GET /products`, `GET /products/{productId}` (id or slug), `GET /categories`, `GET /brands` (published products only, no costs or stock quantities, current prices).
- Screens in `src/app/(store)`: `/products` (listing, search, category/brand filters, sort, pages), `/products/[slug]` (images, variants, add to bag, wishlist, Notify Me, published reviews), `/cart`, `/checkout` (with confirmation), `/account`, `/account/addresses`, `/wishlist`; header search, shop and account links; newest products on the home page.
- Client: `storeSend`, `storePage`, `track`, the `X-Anonymous-Id` header; money display helper.

## Non-Goals
- Order list/detail, cancellation, returns, wallet history, writing reviews (TASK-060; see Open Items).
- Email/phone change, password change and account deactivation screens (Open Items).
- Price-range and in-stock filters, "featured"/"best sellers" sorting, category navigation bar (Open Items).
- Database changes.

## Files / Modules
- `src/server/modules/catalog/storefront-service.ts`, `schemas.ts` (`publicProductsQuerySchema`)
- `src/app/api/v1/products/route.ts`, `products/[productId]/route.ts`, `categories/route.ts`, `brands/route.ts`, `products/catalog-routes.int.test.ts`
- `src/app/(store)/_lib/{api.ts,api.test.ts,format.ts,format.test.ts,types.ts,i18n.tsx}`, `_components/{shop.tsx,address-form.tsx,shell.tsx}`, `page.tsx`
- `src/app/(store)/products/**`, `cart/**`, `checkout/**`, `account/**`, `wishlist/**`
- `docs/api/api-contract.md`, `docs/decisions/ADR-0059-shopping-experience.md`, `docs/tasks/implementation-roadmap.md`

## Business Rules
As implemented by the API; the website adds none. Q20/Q47: sold-out products and wishlist items stay visible with Notify Me. Q37/R38.2: changed prices or stock must be reviewed in the bag (reprice) before checkout; checkout sends the confirmed total. Q138/R36: the shopper chooses the discount. R37: shipping and free shipping come from the checkout quote. R16: guests are told they cannot track orders online. C4/Q167: wallet credit (customers) up to the total.

## API Changes
New public catalog endpoints (API "TASK-059 Amendments"); `GET /products/{productId}` also accepts the slug. No other API change.

## Database Changes
None.

## Security / Authorization
- Catalog endpoints are public and read-only; they expose only published products, current prices and an availability status (no costs, margins or quantities). Unknown/unpublished products are `404`. Query values are validated (`pageSize` ≤ 48, search ≤ 100 characters, UUID filters, slug length ≤ 120).
- Customer screens rely on the API's session checks; guests are redirected to sign-in (`CustomerOnly`). Checkout uses an `Idempotency-Key` per confirmed quote and `expectedTotal`; the server recomputes everything.
- `X-Anonymous-Id` is a random UUID, no personal data (Q146). API messages are not shown verbatim; errors are localized by code/reason.

## Acceptance Criteria
- Listing, search, filters, sort and pagination show published products only, with prices and sold-out status from the API, in Arabic and English.
- Product page: choosing a variant shows its price and images; add to bag updates the header count; sold-out variants offer Notify Me (customers); wishlist add (customers, guests to sign-in); published reviews with average and pages.
- Bag: change quantity, remove, move to wishlist, accept new prices, apply/remove a code or choose an offer; checkout is blocked while the bag needs review.
- Checkout: guest (contact + address) and customer (saved or new address, optional wallet credit) get the API quote (shipping, free shipping, total, amount on delivery) and place the order; changes since the quote send the shopper back to review; confirmation shows the order number.
- Account: profile edit; addresses add/edit/remove/default; wishlist list/remove/move to bag.
- All required checks pass.

## Tests
- Integration `src/app/api/v1/products/catalog-routes.int.test.ts`: published-only listing, no cost/stock fields, language, newest and price sorts with pagination, search by product and brand name, brand and category (with subcategories, inactive category) filters, invalid query, detail by id and slug with sellable variants only, hidden unpublished products, categories tree and brands.
- Unit `src/app/(store)/_lib/api.test.ts` (anonymous id, `storePage`, `storeSend`, 204), `format.test.ts` (money display).
- Screens checked in the browser against a local database (listing, product, bag, guest checkout to confirmation, customer address book, Notify Me, wishlist, profile, customer quote with free shipping; Arabic and English).

## Edge Cases
- A published product whose variants are all archived/unpriced is not listed and is `404`.
- Quantity above stock: `OUT_OF_STOCK` message; the bag marks lines with too little stock or no longer available.
- Form changes after a quote clear it (must review again); a retried "Place order" reuses the same idempotency key.
- A saved address in a deactivated area must be edited (the area list shows active areas only).

## Definition of Done
Acceptance criteria met, docs updated, CI `verify` green, reviewed by the product owner.

## Open Items
- [BUSINESS DECISION REQUIRED] Default listing order: "newest" is used. The Stitch shop page shows "Sort: Featured" and "Best Sellers"/"Bestseller" badges; what "featured"/"best seller" means (manual pick, sales ranking, period) is not defined.
- [BUSINESS DECISION REQUIRED] Stitch shows badges ("NEW", "RARE FIND", "-20% SALE", "Free express ship"), a free-shipping progress bar on the bag and "Complimentary gift samples": none of these has a rule or data source; not built. (The free-shipping threshold could be shown from the quote once the owner decides where.)
- [BUSINESS DECISION REQUIRED] Notify Me channels: both WhatsApp and email are preselected; the customer can untick one. Confirm the default.
- Writing a review: the customer order response has no order item id (`POST /orders/{orderId}/items/{orderItemId}/review` needs it). Planned with the order screens in TASK-060 (additive `id` on customer order items).
- Account: change email, change phone, change password, deactivate account, marketing consents and notification screens are not built yet (APIs exist).
- Catalog: price-range and in-stock filters, category navigation bar in the header, server-rendered product metadata (SEO), search index for larger catalogs.
- `crypto.randomUUID` needs a secure context (HTTPS or localhost); production is HTTPS.

## Status
- [x] Planned
- [x] In Progress
- [x] Tests Passing
- [x] Reviewed
- [x] Done
