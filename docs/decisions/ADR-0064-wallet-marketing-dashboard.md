# ADR-0064 — Discounts, marketing, wallet & notification-log dashboard screens

**Status:** Accepted (TASK-056, 2026-10-15)

## Context
TASK-056 replaces the `discounts`, `marketing`, `wallet` and `notifications` placeholders of the dashboard (TASK-052) with real screens. The API exists for discounts (TASK-026), wallet reads and manual adjustment (TASK-028), segment preview (TASK-047), campaign authoring/approval/send hand-off (TASK-048) and the notification delivery log (TASK-045). Campaign delivery and frequency limits (TASK-049) and refunds (TASK-040/041) are not built. Some reads the screens would naturally use do not exist: there is no admin customer search or customer read, no single-discount read and no admin view of a customer's marketing consent. There is no Stitch reference for dashboard screens.

## Decision
1. **Same pattern as ADR-0053/0058.** Client of `/api/v1/**` only, response types imported type-only, `_components/catalog-ui.tsx` pieces, money typed in pounds and sent as integer piastres (`_lib/money.ts`). Screen texts live in a new `_lib/marketing-i18n.ts` (Arabic and English) with its own error mapper for the feature reasons (`CODE_TAKEN`, `CAMPAIGN_STATUS_INVALID`, `CAMPAIGN_AUDIENCE_EMPTY`, `CUSTOMER_DEACTIVATED`, `SELF_APPROVAL`, `WALLET_INSUFFICIENT_FUNDS`, `IDEMPOTENCY_CONFLICT`). No shared shell file changes: the four sections and their permissions already exist in `_lib/navigation.ts`.
2. **Routes.** `/staff/discounts` (list, search, status filter, create/edit inline, activate/deactivate), `/staff/marketing` (campaign list with status/channel filters, new draft) and `/staff/marketing/[id]` (detail, edit while `DRAFT`, submit, approve/reject, send, history), `/staff/wallet` (`?customer={id}`), `/staff/notifications` (`?orderId={id}`; status, channel and order filters).
3. **Discount editing from the list.** Without `GET /admin/discounts/{id}`, the editor is filled from the list row and saves the whole form with `PATCH` (target lists replace the current ones, API behavior). A store-wide discount sends empty target lists.
4. **Target and segment pickers** (`discounts/targets.tsx`) read the admin catalog lists (`PRODUCT_VIEW`): a checkbox list for brands (first 100) and categories, a product search for products. Discount targets and the `PRODUCT_BUYERS`/`BRAND_BUYERS`/`CATEGORY_BUYERS` segments share them.
5. **Segment builder.** The seven TASK-047 types are offered with their parameters; staff type the inactivity days and the minimum spend (pounds → piastres), as Q141 leaves thresholds to staff. The opted-in audience size is fetched with `POST /admin/segments/preview` about 400 ms after the audience changes. The subject field shows for email only.
6. **Campaign actions mirror the API contract table** (TASK-048 amendments): edit and submit in `DRAFT`, approve/reject in `PENDING_APPROVAL` (rejection needs a reason), send in `APPROVED` after a confirmation. The approve/reject buttons are replaced by a note when the viewer made the latest submission (ADR-0018); the API still refuses with `SELF_APPROVAL`. After sending, only `recipientCount` is shown with a note that delivery is not available yet; nothing about delivery is shown or invented.
7. **Wallet by customer id.** The wallet is opened by pasting a customer id or through `/staff/wallet?customer={id}` (the customers screen can link to it). The adjustment requires a reason and a confirmation; its `Idempotency-Key` is kept while the same body is retried and replaced when the body changes or after success (`idempotencyKeyFor`), so a lost answer cannot post twice and a changed request is not refused as a key conflict.
8. **Gaps are not filled by invention.** Customer search, the consent view and campaign delivery results are open items in the task file, not new endpoints.

## Consequences
- No API, database or permission changes.
- Staff need the customer id to open a wallet until a customer search exists.
- Pickers need `PRODUCT_VIEW`; without it the picker shows the access error while the rest of the form works.
