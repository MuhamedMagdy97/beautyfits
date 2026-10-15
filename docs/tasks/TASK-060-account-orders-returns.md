# TASK-060 — Order Tracking & Returns Integration (customer account)

## Goal
Signed-in customers follow and manage their orders and returns on the website: order history and detail with status timeline and delivery tracking, cancellation and shipping-cancellation requests, order changes with revision confirmation, return requests with photos, return status, wallet, reviews of delivered items, and the remaining account screens (email, mobile and password change, marketing consent, notification center, closing the account). Guests confirm COD orders from the WhatsApp link.

## Dependencies
TASK-058, TASK-059 (storefront and shopping screens); TASK-009, TASK-028, TASK-030 … TASK-038, TASK-044 … TASK-046 (APIs). Refund calculation and return completion (TASK-040/041) are not built yet: refunds are not shown.

## Source of Truth
- `docs/product/business-spec.md` (R2, R11, R16, R21, R23, R30, R34, R40; Q26, Q34, Q53, Q59, Q60, Q90–Q93, Q100, Q127)
- `docs/product/user-flows.md` (orders, returns, account)
- `docs/api/api-contract.md` §11, §15–§18, §20, §28 and "TASK-009", "TASK-028", "TASK-030" … "TASK-038", "TASK-044" … "TASK-046", "TASK-060" Amendments
- `docs/decisions/ADR-0062-account-orders-returns.md`
- Visual reference: `design-reference/google-stitch/beautyfits_account_orders_wallet`, `editorial_velvet/DESIGN.md`

## Scope
- API (additive): `customerOrder.items[].id` (the order line).
- Website (`src/app/(store)`):
  - `/account/orders`, `/account/orders/[orderId]`: status history, payment summary, delivery address, shipment tracking (carrier, tracking number, events), cancel (R11) or ask to stop the delivery once shipped, change request (quantities, remove lines, another saved address) and revision confirmation, return request, review per delivered line.
  - `/account/returns`, `/account/returns/[returnId]`: status, claim, items, photo count, rejection reason, pickup (carrier, tracking, fee payer), add photos and withdraw while waiting for review, new request after rejection.
  - `/account/wallet`: available, balance, held amount, paginated ledger.
  - `/account/notifications`: list, mark one / all as read, open the linked order or product.
  - `/account/settings`: change email (code to the new email), change mobile (code to the account email), change password, marketing consent per channel, close the account.
  - `/orders/[orderId]/confirm-cod`: target of the WhatsApp COD link (token in the URL fragment, explicit click).
  - Account switcher linking all screens; header menu and footer links.

## Non-Goals
- Refund amounts, return completion, manual refunds (TASK-040/041).
- Adding new products to an existing order (the customer re-orders).
- Guest order claiming screen (`/guest/orders/claim`, TASK-010 API) — not requested here.
- Editing or reporting reviews (`PATCH /reviews/{id}`, `POST /reviews/{id}/report`).
- Database changes.

## Files / Modules
- `src/server/modules/orders/orders-service.ts` (`CustomerOrderView.items[].id`), `src/app/api/v1/admin/orders/orders-routes.int.test.ts`
- `src/app/(store)/_lib/account.ts`, `account.test.ts`, `i18n.tsx`
- `src/app/(store)/account/account-nav.tsx`, `account/orders/**`, `account/returns/**`, `account/wallet/**`, `account/notifications/**`, `account/settings/**`
- `src/app/(store)/orders/[orderId]/confirm-cod/**`
- `src/app/(store)/_components/shell.tsx` (links only)
- `docs/api/api-contract.md`, `docs/decisions/ADR-0062-account-orders-returns.md`, `docs/decisions/README.md`, `docs/tasks/implementation-roadmap.md`

## Business Rules
As implemented by the API; the website adds none. Buttons are offered by order status following R11 (cancel up to Ready for Shipment; shipping-cancellation request once Shipped), TASK-032 (changes before Preparing) and R21/Q34/Q100 (returns and reviews of delivered orders); the API decides and its refusals are shown. R16: the COD link page shows only the confirmation. R34: closing the account needs the password and an explicit acknowledgement; open orders, returns or wallet credit are listed when refused. Q59/Q60: consent per channel, never pre-enabled. Q26: refunds go to the wallet (shown as a note, no amounts).

## API Changes
`customerOrder.items[]` gains `id` (API "TASK-060 Amendments"). Additive; no other change.

## Database Changes
None.

## Security / Authorization
- All account screens require a customer session (`CustomerOnly` → sign-in); every endpoint authorizes server-side (own orders/returns only, 404 otherwise).
- Return photos: customer-only `RETURN_EVIDENCE` uploads through the documented flow; the browser sends the bytes with the single-use upload headers only.
- COD token: read from the URL fragment (not sent to the server with the page request, not in logs), posted only on an explicit click; `Referrer-Policy: no-referrer` on that page.
- Passwords and codes are sent only to their endpoints and never stored or logged by the website.

## Acceptance Criteria
- [x] Order list (paginated) and detail with status timeline, tracking, totals and address.
- [x] Cancel / stop delivery with an explicit confirmation step; change request → revision shown → confirm.
- [x] Return request from a delivered order with claim type, lines, units, reason and photos; return list and detail with status, rejection reason and pickup; withdraw and resubmit.
- [x] Wallet balance and ledger.
- [x] Review of a delivered order line (uses the new `items[].id`).
- [x] Email, mobile and password change; marketing consent; notification center; account closing with a clear confirmation.
- [x] Arabic (RTL, default) and English; phone width.
- [x] No price, total, refund or eligibility computed in the website.

## Tests
- Integration: `orders-routes.int.test.ts` checks `items[].id` equals the order line id.
- Unit: `_lib/account.test.ts` (offered actions by status, notification links, snapshot names, address line).
- Manual: browser verification on a dev database seeded with `npm run db:seed:dev` (see below).

## Edge Cases
- One variant on two lines after a change (R40): summed into one row in the change form.
- Review already written for the product in this order: `409` with `details.reviewId` → "already reviewed".
- Photo refused at completion (size, dimensions, type) → localized issue message, nothing created.
- COD link without token, wrong token, or order no longer pending → explanatory message.
- Deactivation refused with open items → items listed.

## Definition of Done
Lint, format, typecheck, unit and integration tests and build pass; docs updated; reviewed by the product owner.

## Open Items
- [BUSINESS DECISION REQUIRED] COD confirmation from the account: a signed-in customer can confirm only through the WhatsApp link (or by phone with staff). Should the account page let the signed-in owner confirm a `PENDING_CONFIRMATION` order directly? Not built.
- [BUSINESS DECISION REQUIRED] Stitch elements without a rule or data source, not built: VAT invoice download, "membership ID" / customer tier ("Prestige connoisseur", "Tier protection"), wallet "Redeem" and withdrawal via the customer-care hotline, a refund-destination choice (refunds go to the wallet, Q26), "concierge support" hours.
- [BUSINESS DECISION REQUIRED] Should customers see their own return photos? `GET /files/{id}/content` serves `RETURN_EVIDENCE` to staff only; the return shows the photo count.
- Return window display ("10 days remaining" in Stitch): the website must not compute it and the order response has no `returnWindowEndsAt`; an additive API field would be needed (owner to confirm it is wanted).
- Reviews: no list of the customer's own reviews and no edit/report screens (`PATCH /reviews/{id}`, `POST /reviews/{id}/report` exist).
- Guest order claiming screen (TASK-010 API) is not built; checkout's guest note still says to contact customer service.

## Status
- [x] Planned
- [x] In Progress
- [x] Tests Passing
- [ ] Reviewed
- [ ] Done
