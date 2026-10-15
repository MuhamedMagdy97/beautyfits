# TASK-056 — Wallet, Marketing & Notifications Dashboard

## Goal
Staff manage discounts and marketing campaigns, look up and correct customer wallets, and read the notification delivery log from real dashboard screens (Arabic RTL and English), replacing the TASK-052 placeholders for `discounts`, `marketing`, `wallet` and `notifications`.

## Dependencies
TASK-026 (discounts), TASK-028 (wallet), TASK-045 (notification delivery log), TASK-047 (segments), TASK-048 (campaigns), TASK-052 (dashboard shell). TASK-049 (campaign delivery) and TASK-040/041 (refunds) are not built; this task covers the part that is buildable now.

## Source of Truth
- Business Spec Q13, Q78, Q139–Q142, R19, R36
- User Flows §16.2, §16.4, §16.5
- API Contract §18, §23, §24, "TASK-026/028/045/047/048 Amendments"
- Permission catalog §2 (`DISCOUNT_VIEW`, `DISCOUNT_MANAGE`, `MARKETING_*`, `VIEW_WALLET_BALANCE`, `ADJUST_WALLET` Owner/Admin only, `NOTIFICATION_LOG_VIEW`, `VIEW_CUSTOMER_CONTACT`)
- Design reference: no dashboard screen exists in `design-reference/google-stitch/`; the screens follow the Editorial Velvet tokens of the TASK-052 shell
- ADR-0018, ADR-0045, ADR-0053, ADR-0058, ADR-0061; ADR-0064 (this task)

## Scope
- `/staff/discounts`: list, search, status filter, create, edit, activate/deactivate.
- `/staff/marketing`: campaign list (status/channel filters) and new draft; `/staff/marketing/[id]`: detail, edit draft, submit, approve/reject with reason, send, history. Segment builder for the seven TASK-047 types with the live opted-in audience count.
- `/staff/wallet` (`?customer={id}`): balance/held/available, ledger with staff reasons, manual credit/debit with reason and a stable `Idempotency-Key`.
- `/staff/notifications` (`?orderId={id}`): delivery log with status, channel and order filters; recipients only with `VIEW_CUSTOMER_CONTACT` (API).

## Non-Goals
- Campaign delivery, delivery results, frequency limits, retries (TASK-049).
- Refund screens (TASK-040/041).
- Consent views and customer search (no admin endpoints; see Open Items).
- Any API, database, permission, navigation or shell change.

## Files / Modules
- `src/app/staff/_lib/{marketing-i18n.ts,marketing.ts,marketing.test.ts}`
- `src/app/staff/(shell)/discounts/{page.tsx,targets.tsx}`
- `src/app/staff/(shell)/marketing/{page.tsx,editor.tsx,[id]/page.tsx}`
- `src/app/staff/(shell)/wallet/{page.tsx,wallet.tsx}`
- `src/app/staff/(shell)/notifications/{page.tsx,deliveries.tsx}`

## Business Rules
Applied by the API; the screens only mirror them:
- R36: whole-percent discounts 1–100; new discounts start inactive; codes are unique.
- Q142, ADR-0018: campaigns need Owner/Admin approval and nobody approves their own submission; a rejection needs a reason and returns the campaign to draft.
- Q13: sending is a manual action (confirmed in the screen); Q140: the audience is customers opted in to the channel at that moment.
- Q78: manual wallet adjustments are Owner/Admin only and need a reason; a debit cannot exceed the available credit.

## API Changes
None.

## Database Changes
None.

## Security / Authorization
Every action is authorized by the API; the screens hide actions cosmetically by permission and show access denied without the section's read permission. Money is typed in pounds and sent as integer piastres. The wallet adjustment sends an `Idempotency-Key` that is reused for retries of the same body. Staff-only wallet reasons are shown only on the staff screen.

## Acceptance Criteria
- The four sections render real screens in Arabic and English; without the read permission they show access denied.
- Discounts can be created, edited, activated and deactivated; API refusals (code taken, invalid targets, dates) are shown localized.
- A campaign draft can be created with any TASK-047 segment showing the live audience count, edited, submitted, approved or rejected (with reason) by another Owner/Admin, and sent; after sending the recipient count is shown and nothing about delivery is invented.
- A wallet opens by customer id; an Owner/Admin can credit or debit with a reason; a retried request does not post twice.
- The delivery log filters by status, channel and order.
- All required checks pass.

## Tests
- Unit `src/app/staff/_lib/marketing.test.ts`: discount form ↔ body (pounds → piastres, blanks, store-wide targets, unreadable amounts), segment builder for every type, idempotency key reuse, UUID parsing, localized feature errors, Arabic/English key parity.
- The screens call existing endpoints covered by their integration tests (discounts, wallet, segments, campaigns, notifications); no endpoint changes.

## Edge Cases
- Incomplete segment (no products chosen, no days, unreadable spend): no preview call; saving is refused in the form.
- Debit above the available credit: the API's available amount is shown.
- A reused key with a changed body cannot happen from the screen (the key changes with the body).
- Campaign status changed by someone else: the API's `CAMPAIGN_STATUS_INVALID` is shown; refresh shows the new state.

## Definition of Done
Acceptance criteria met, docs updated, CI `verify` green, reviewed by the product owner.

## Open Items
- **Consent views not built:** there is no admin endpoint to read a customer's marketing consent (only `GET/PUT /me/marketing-consents`). A read-only `GET /admin/customers/{id}/marketing-consents` (and a permission for it) needs a task; [BUSINESS DECISION REQUIRED] which roles may see consent history.
- **Customer search missing:** no `GET /admin/customers` or customer read exists, so the wallet is opened by customer id or by the link `/staff/wallet?customer={id}` from the customers screen (being built in parallel).
- **Delivery results:** TASK-049 adds per-recipient delivery status and frequency limits; the campaign screen shows only `recipientCount` until then.
- **Discount usage detail:** only `usedCount` is available; no per-order usage list endpoint exists.
- No Stitch design exists for these screens; the layout is a proposal.

## Status
- [x] Planned
- [x] In Progress
- [x] Tests Passing
- [ ] Reviewed
- [ ] Done
