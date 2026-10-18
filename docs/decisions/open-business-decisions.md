# Open Business Decisions — Owner Review

Compiled 2026-10-17 from every `[BUSINESS DECISION REQUIRED]` marker and "Open Items" section in the docs (tasks, ADRs, product, architecture, API and database documents), plus the not-yet-merged TASK-062, TASK-063 and TASK-064 files.

**Status (2026-10-18):** the owner has decided every item. Each item keeps its ID and gets a **Decision:** line. No item is open.

## Decided 2026-10-18

Owner instruction in chat: "do the recommended", i.e. keep the current provisional behaviour for every open item.

- **Confirmed:** every item's "Now" behaviour (or the "(now)" option in the question) is kept. Where "Now" means not built, not possible or no message, the decision is "not in v1; keep as is".
- **Accepted proposals:** BD-016 (missing parts follow R7, as coded), BD-067 (brand/category reports not in v1, possible follow-up task), BD-072 (restore drill monthly and after major releases), BD-073 (e2e becomes a required check; the owner enables it in GitHub branch protection).
- **No mobile app for now.** Mobile-only items are deferred: BD-086 push notifications, app/universal links (TASK-067).
- **No production hosting for now** (confirmed again). Items that need hosting, a vendor or a production setup are deferred: BD-068 CAPTCHA provider, BD-075 alert recipients/channels, WhatsApp pre-approved templates (BD-052), plus the list under "Deferred" below.
- **Second answer the same day** (owner: "use sensible defaults"): BD-060 review rate limits set to 20 writes and 20 reports per customer per hour; BD-049 a sole Owner's campaign is approved on submit. Both implemented.

## Decided 2026-10-17

- **No production hosting for now.** The project stays on localhost. Hosting provider, off-site backup storage, error-tracking vendor and the production deployment task (TASK-066) are **deferred**, not open now (see "Deferred" below).
- **Next.js security patch approved:** 16.3.5 to 16.3.8 (same minor; also `eslint-config-next`). Source: [TASK-061 Open Items](../tasks/TASK-061-security-review.md) (row 35). To be applied by a separate task.

## Returns & Refunds

**BD-001** Should support staff be able to create a return for a guest order, and with which permission?
Now: not possible; return endpoints need a customer account.
Source: [TASK-037 Open Items](../tasks/TASK-037-return-requests.md)
**Decision:** Resolved (owner decision 2026-10-18): not in v1; keep as is — support staff cannot create returns for guest orders; return endpoints need a customer account.

**BD-002** Confirm the return photo limits (10 photos per return, 30 uploads per customer per hour, at least 500 x 500 px). Are videos needed?
Now: those limits, no video.
Source: [TASK-037 Open Items](../tasks/TASK-037-return-requests.md)
**Decision:** Resolved (owner decision 2026-10-18): keep current behaviour — 10 photos per return, 30 uploads per customer per hour, at least 500 x 500 px, no video.

**BD-003** Should customers see/download their own return photos, and add photos after approval?
Now: staff only; the customer sees only the photo count.
Sources: [TASK-037](../tasks/TASK-037-return-requests.md), [TASK-060](../tasks/TASK-060-account-orders-returns.md) (Open Items)
**Decision:** Resolved (owner decision 2026-10-18): keep current behaviour — return photos are staff only; the customer sees the photo count and cannot add photos after approval.

**BD-004** Return pickup fee: who pays at pickup (before inspection decides responsibility), and if the final responsibility differs, does BeautyFits add the fee to the refund (customer paid but store/carrier at fault) or deduct it (the reverse)?
Now: staff record a provisional payer, customer by default; nothing is added or deducted (the system only reports the difference); fixing it later means a manual wallet adjustment.
Sources: [TASK-038](../tasks/TASK-038-return-approval.md), [TASK-040](../tasks/TASK-040-refund-rules.md), [TASK-041](../tasks/TASK-041-wallet-refund-completion.md), [TASK-002A item 10](../tasks/TASK-002A-docs-closure.md)
**Decision:** Resolved (owner decision 2026-10-18): keep current behaviour — staff record a provisional pickup-fee payer (customer by default); nothing is added to or deducted from the refund; a difference is corrected by a manual wallet adjustment.

**BD-005** What happens if a scheduled return pickup must change (other carrier, missed pickup, customer unreachable)?
Now: not possible; no rule.
Source: [TASK-038](../tasks/TASK-038-return-approval.md)
**Decision:** Resolved (owner decision 2026-10-18): not in v1; keep as is — a scheduled pickup cannot be changed in the system.

**BD-006** May a customer or staff cancel a return after it was approved but before pickup?
Now: customers can withdraw only while pending approval.
Source: [TASK-038](../tasks/TASK-038-return-approval.md)
**Decision:** Resolved (owner decision 2026-10-18): keep current behaviour — customers can withdraw only while the return is pending approval.

**BD-007** Which customer messages (and channel/wording) for return approved, rejected, pickup scheduled and return received?
Now: events are recorded but no message template or channel exists.
Sources: [TASK-038](../tasks/TASK-038-return-approval.md), [TASK-039](../tasks/TASK-039-return-inspection.md)
**Decision:** Resolved (owner decision 2026-10-18): not in v1; keep as is — return events are recorded; no customer message for approval, rejection, pickup or receipt.

**BD-008** Damaged and rejected returned units: should damaged ones go into Damaged (non-sellable) stock, and what physically happens to rejected ones (sent back to the customer? at whose cost?). Also confirm rejected units get no refund for every claim type.
Now: they are recorded but enter no stock bucket; rejected = no refund.
Sources: [TASK-039](../tasks/TASK-039-return-inspection.md), [TASK-040](../tasks/TASK-040-refund-rules.md)
**Decision:** Resolved (owner decision 2026-10-18): keep current behaviour — damaged and rejected returned units are recorded but enter no stock bucket; rejected units get no refund for every claim type; the physical handling of rejected units stays outside the system.

**BD-009** If fewer units arrive than requested, how are the missing units recorded and refunded?
Now: no "not received" outcome exists.
Source: [TASK-039](../tasks/TASK-039-return-inspection.md)
**Decision:** Resolved (owner decision 2026-10-18): not in v1; keep as is — no "not received" outcome; every requested unit gets an inspection outcome.

**BD-010** Do we need a way to correct a mistaken inspection, assessment or resolution?
Now: all three are final once saved (audited).
Sources: [TASK-039](../tasks/TASK-039-return-inspection.md), [TASK-040](../tasks/TASK-040-refund-rules.md)
**Decision:** Resolved (owner decision 2026-10-18): keep current behaviour — inspection, assessment and resolution are final once saved (audited).

**BD-011** Must inspection notes be required (e.g. for Damaged/Rejected)?
Now: optional.
Source: [TASK-039](../tasks/TASK-039-return-inspection.md)
**Decision:** Resolved (owner decision 2026-10-18): keep current behaviour — inspection notes are optional.

**BD-012** What should the customer see once a return is resolved (per-item outcomes, notes, staff photos)?
Now: status and received date only.
Source: [TASK-039](../tasks/TASK-039-return-inspection.md)
**Decision:** Resolved (owner decision 2026-10-18): keep current behaviour — the customer sees the return status and received date only.

**BD-013** Who records the final responsibility (customer / BeautyFits / carrier)? Options: Owner/Admin via the complete-return permission (now), the inspector, or a new dedicated permission.
Source: [TASK-040](../tasks/TASK-040-refund-rules.md)
**Decision:** Resolved (owner decision 2026-10-18): keep current behaviour — Owner/Admin record it with the complete-return permission (`COMPLETE_RETURN`).

**BD-014** Delivery fee on a partial store-fault return: refund the full original fee once per order (now), or prorate?
Source: [TASK-040](../tasks/TASK-040-refund-rules.md)
**Decision:** Resolved (owner decision 2026-10-18): keep current behaviour — the full original delivery fee, once per order.

**BD-015** Customer-caused damaged units: one decision per order line (now), or may staff split a line (keep one unit, send one back)?
Source: [TASK-040](../tasks/TASK-040-refund-rules.md)
**Decision:** Resolved (owner decision 2026-10-18): keep current behaviour — one decision per order line; no split.

**BD-016** Confirm that units with "missing parts" on a customer-caused return are treated like opened/used units (25% rule).
Source: [TASK-040](../tasks/TASK-040-refund-rules.md)
**Decision:** Resolved (owner decision 2026-10-18): accepted — missing-parts units on a customer-caused return follow the R7 rule like opened/used units (return to the customer, or keep with the 25% refund). The code already does this: `src/server/modules/returns/refunds.ts` treats every customer-caused `DAMAGED` outcome, whatever its condition, through the R7 resolution.

**BD-017** The status "partially completed" has no defined meaning. Can part of a return be refunded while other lines wait, or drop the status?
Now: a return completes all at once.
Source: [TASK-041](../tasks/TASK-041-wallet-refund-completion.md)
**Decision:** Resolved (owner decision 2026-10-18): keep current behaviour — a return completes all at once; `PARTIALLY_COMPLETED` stays unused.

**BD-018** Should the refund to the wallet happen when staff click "complete" (now), or automatically once inspection finishes?
Source: [TASK-041](../tasks/TASK-041-wallet-refund-completion.md)
**Decision:** Resolved (owner decision 2026-10-18): keep current behaviour — the wallet refund is created when staff click "complete".

## Wallet

**BD-019** Wallet "Redeem", withdrawal via the customer-care hotline, and a choice of refund destination (now refunds always go to the wallet): wanted or not?
Now: not built.
Source: [TASK-060 Open Items](../tasks/TASK-060-account-orders-returns.md)
**Decision:** Resolved (owner decision 2026-10-18): not in v1; keep as is — no wallet Redeem, no hotline withdrawal, no refund-destination choice; refunds go to the wallet.

## Orders / COD

**BD-020** Support-assisted linking of a guest order to an account with another or missing email: who may do it, what identity checks, and is approval needed?
Now: no admin function; customers use the email-code claim flow.
Source: [TASK-010 Open Items](../tasks/TASK-010-guest-order-claiming.md)
**Decision:** Resolved (owner decision 2026-10-18): not in v1; keep as is — no support-assisted linking; customers use the email-code claim flow.

**BD-021** May a signed-in customer confirm a pending COD order directly from the account page?
Now: only via the WhatsApp link (or by phone with staff).
Source: [TASK-060](../tasks/TASK-060-account-orders-returns.md)
**Decision:** Resolved (owner decision 2026-10-18): keep current behaviour — COD confirmation only through the WhatsApp link (or by phone with staff).

**BD-022** COD cash collection/reconciliation with carriers: in v1 or not? (Status unconfirmed: listed as open in the TASK-002A list, no later decision found.)
Now: not built.
Source: [TASK-002A, "Remaining open decisions" item 9](../tasks/TASK-002A-docs-closure.md)
**Decision:** Resolved (owner decision 2026-10-18): not in v1; keep as is — no COD cash collection/reconciliation with carriers.

## Shipping

**BD-023** May staff enter an earlier actual delivery time (back-dating), and with what limit/permission? (The return window counts from the delivery date.)
Now: delivery time is when staff enter it.
Source: [TASK-034](../tasks/TASK-034-shipment-core.md)
**Decision:** Resolved (owner decision 2026-10-18): keep current behaviour — delivery time is when staff enter it; no back-dating.

**BD-024** May a shipment go directly from Shipped to Delivered, skipping Out for Delivery?
Now: strict, Out for Delivery is required.
Source: [TASK-034](../tasks/TASK-034-shipment-core.md)
**Decision:** Resolved (owner decision 2026-10-18): keep current behaviour — Out for Delivery is required before Delivered.

**BD-025** After a failed-delivery task is closed and deliveries keep failing: open a new task each time (now), or one task per shipment ever?
Source: [TASK-035](../tasks/TASK-035-delivery-failures.md)
**Decision:** Resolved (owner decision 2026-10-18): keep current behaviour — a new task each time deliveries keep failing after a task was closed.

**BD-026** Should a failed-delivery task close automatically when the shipment is delivered or returned?
Now: staff close it.
Source: [TASK-035](../tasks/TASK-035-delivery-failures.md)
**Decision:** Resolved (owner decision 2026-10-18): keep current behaviour — staff close the task.

**BD-027** Should the customer be notified of a failed delivery attempt (WhatsApp/email)?
Now: no.
Source: [TASK-035](../tasks/TASK-035-delivery-failures.md)
**Decision:** Resolved (owner decision 2026-10-18): not in v1; keep as is — no failed-delivery message to the customer.

**BD-028** Shipping damage: should a carrier damage claim or carrier charge be recorded?
Now: damaged units go to Damaged stock only.
Source: [TASK-036](../tasks/TASK-036-shipping-cancellation.md)
**Decision:** Resolved (owner decision 2026-10-18): keep current behaviour — damaged units go to Damaged stock only; no carrier claim or charge.

**BD-029** Lost or missing units in a returned parcel are not modelled (each unit is intact or damaged). How should they be handled?
Source: [TASK-036](../tasks/TASK-036-shipping-cancellation.md)
**Decision:** Resolved (owner decision 2026-10-18): not in v1; keep as is — lost/missing units are not modelled; each unit is recorded intact or damaged.

## Catalog / Inventory

**BD-030** Supplier ledger corrections (mistaken payment or entry): who may do it, which permission, is approval needed?
Now: not available; entries are never changed.
Sources: [ADR-0029 §6](ADR-0029-supplier-returns-ledger.md), [TASK-024](../tasks/TASK-024-supplier-returns-ledger.md), [roadmap](../tasks/implementation-roadmap.md)
**Decision:** Resolved (owner decision 2026-10-18): not in v1; keep as is — supplier ledger entries are never changed; no correction flow.

## Marketing & Notifications

**BD-031** Which order events notify the customer, and the wording?
Now: order received, COD request/reminder, COD confirmed, order accepted, order expired.
Source: [TASK-045](../tasks/TASK-045-notification-service.md)
**Decision:** Resolved (owner decision 2026-10-18): keep current behaviour — order received, COD request/reminder, COD confirmed, order accepted, order expired, with the current wording.

**BD-032** Retry policy for order messages.
Now: up to 5 runs, at 5, 10, 15, 20 minutes.
Source: [TASK-045](../tasks/TASK-045-notification-service.md)
**Decision:** Resolved (owner decision 2026-10-18): keep current behaviour — up to 5 runs, at 5, 10, 15, 20 minutes.

**BD-033** Email fallback for the COD confirmation link?
Now: WhatsApp only.
Source: [TASK-045](../tasks/TASK-045-notification-service.md)
**Decision:** Resolved (owner decision 2026-10-18): keep current behaviour — WhatsApp only.

**BD-034** When is the first wishlist/restock reminder due?
Now: 3 days after the item was added, then every 3 days.
Source: [TASK-043](../tasks/TASK-043-restock-reminders.md)
**Decision:** Resolved (owner decision 2026-10-18): keep current behaviour — 3 days after the item was added, then every 3 days.

**BD-035** What counts as "purchased" (stops reminders)?
Now: an order by the customer containing the variant, placed after it was added, not cancelled or expired.
Source: [TASK-043](../tasks/TASK-043-restock-reminders.md)
**Decision:** Resolved (owner decision 2026-10-18): keep current behaviour — an order by the customer containing the variant, placed after it was added, not cancelled or expired.

**BD-036** Out-of-stock wishlist items: no reminder (now, "Notify Me" is the offer)? Confirm.
Source: [TASK-043](../tasks/TASK-043-restock-reminders.md)
**Decision:** Resolved (owner decision 2026-10-18): keep current behaviour — no reminder for out-of-stock wishlist items; Notify Me is the offer.

**BD-037** If a customer re-gives marketing consent, should stopped reminders restart?
Now: they stay stopped.
Source: [TASK-043](../tasks/TASK-043-restock-reminders.md)
**Decision:** Resolved (owner decision 2026-10-18): keep current behaviour — stopped reminders stay stopped.

**BD-038** Confirm "Notify Me" is accepted only while the item cannot be bought (otherwise refused as "in stock").
Source: [TASK-043](../tasks/TASK-043-restock-reminders.md)
**Decision:** Resolved (owner decision 2026-10-18): keep current behaviour — Notify Me only while the item cannot be bought; otherwise `409 VARIANT_IN_STOCK`.

**BD-039** Arabic/English wording of restock and reminder messages, and the product link.
Source: [TASK-043](../tasks/TASK-043-restock-reminders.md)
**Decision:** Resolved (owner decision 2026-10-18): keep current behaviour — the ar/en wording in `src/server/modules/notifications/templates.ts` and the link `WEBSITE_URL/products/{slug}`.

**BD-040** "Notify Me" channels: both WhatsApp and email preselected (customer can untick). Confirm the default.
Source: [TASK-059](../tasks/TASK-059-shopping-experience.md)
**Decision:** Resolved (owner decision 2026-10-18): keep current behaviour — both WhatsApp and email preselected; the customer can untick one.

**BD-041** How long is marketing consent history kept?
Now: forever (no personal data beyond the customer id).
Source: [TASK-046](../tasks/TASK-046-marketing-consent-ledger.md)
**Decision:** Resolved (owner decision 2026-10-18): keep current behaviour — kept forever.

**BD-042** After an email or phone change, does marketing consent carry over to the new address or reset to opted out?
Now: carries over.
Source: [TASK-046](../tasks/TASK-046-marketing-consent-ledger.md)
**Decision:** Resolved (owner decision 2026-10-18): keep current behaviour — consent carries over.

**BD-043** Offer an (unticked) marketing opt-in checkbox at registration?
Now: no; customers opt in from their account.
Source: [TASK-046](../tasks/TASK-046-marketing-consent-ledger.md)
**Decision:** Resolved (owner decision 2026-10-18): keep current behaviour — no checkbox at registration; customers opt in from their account.

**BD-044** Which roles may see a customer's marketing consent history in the dashboard?
Now: no admin screen.
Source: [TASK-056](../tasks/TASK-056-wallet-marketing-dashboard.md)
**Decision:** Resolved (owner decision 2026-10-18): not in v1; keep as is — no admin screen for consent history.

**BD-045** Which order statuses make a customer a "buyer" for segments?
Now: confirmed through delivered (same as revenue); returns not deducted.
Source: [TASK-047](../tasks/TASK-047-customer-segmentation.md)
**Decision:** Resolved (owner decision 2026-10-18): keep current behaviour — confirmed through delivered; returns not deducted.

**BD-046** "Inactive X days": count buying orders only (now; never-buyers excluded), or also sign-ins/views?
Source: [TASK-047](../tasks/TASK-047-customer-segmentation.md)
**Decision:** Resolved (owner decision 2026-10-18): keep current behaviour — buying orders only; never-buyers excluded.

**BD-047** "High-spending": lifetime merchandise spend, no shipping, no return deduction (now). Over a period, include shipping, or deduct returns?
Source: [TASK-047](../tasks/TASK-047-customer-segmentation.md)
**Decision:** Resolved (owner decision 2026-10-18): keep current behaviour — lifetime merchandise spend, no shipping, no return deduction.

**BD-048** Opted-in customers whose account is suspended or unverified: exclude from marketing?
Now: included.
Source: [TASK-047](../tasks/TASK-047-customer-segmentation.md)
**Decision:** Resolved (owner decision 2026-10-18): keep current behaviour — they are included.

**BD-049** A campaign by an Owner/Admin needs a second Owner/Admin to approve. Auto-approve for a sole Owner, as purchase orders do?
Source: [TASK-048](../tasks/TASK-048-campaigns.md)
**Decision:** Resolved (owner decision 2026-10-18): a sole Owner (no other active Owner/Admin) gets the campaign approved on submit, audited as `CAMPAIGN_APPROVED`; otherwise a second Owner/Admin approves as before.

**BD-050** Rejected campaigns return to draft (now) or are final?
Source: [TASK-048](../tasks/TASK-048-campaigns.md)
**Decision:** Resolved (owner decision 2026-10-18): keep current behaviour — rejected campaigns return to draft.

**BD-051** Who may cancel a campaign, from which statuses?
Now: no cancel function.
Source: [TASK-048](../tasks/TASK-048-campaigns.md)
**Decision:** Resolved (owner decision 2026-10-18): not in v1; keep as is — no campaign cancel function.

**BD-052** Campaign language: one text per campaign (now), or Arabic and English versions? Must WhatsApp campaigns use pre-approved templates?
Source: [TASK-048](../tasks/TASK-048-campaigns.md)
**Decision:** Resolved (owner decision 2026-10-18): keep current behaviour — one text per campaign. Pre-approved WhatsApp templates: Deferred (owner 2026-10-18): localhost only for now (provider).

**BD-053** Marketing frequency limit (maximum messages per window).
Now: no limit (0); window 7 days.
Source: [TASK-049](../tasks/TASK-049-marketing-delivery.md)
**Decision:** Resolved (owner decision 2026-10-18): keep current behaviour — no limit (0); window 7 days.

**BD-054** Marketing delivery retries and spacing.
Now: up to 5 attempts, waiting attempt x 5 minutes.
Source: [TASK-049](../tasks/TASK-049-marketing-delivery.md)
**Decision:** Resolved (owner decision 2026-10-18): keep current behaviour — up to 5 attempts, waiting attempt x 5 minutes.

**BD-055** Email subject used when a WhatsApp campaign falls back to email.
Now: "BeautyFits".
Source: [TASK-049](../tasks/TASK-049-marketing-delivery.md)
**Decision:** Resolved (owner decision 2026-10-18): keep current behaviour — "BeautyFits".

**BD-056** Should campaign messages carry a one-click unsubscribe link?
Now: no; customers opt out in their account.
Sources: [TASK-049](../tasks/TASK-049-marketing-delivery.md) (also mentioned by TASK-046, ADR-0051)
**Decision:** Resolved (owner decision 2026-10-18): not in v1; keep as is — no unsubscribe link; customers opt out in their account.

**BD-057** Do wishlist purchase reminders count towards the marketing frequency limit?
Now: only campaigns count.
Source: [TASK-049](../tasks/TASK-049-marketing-delivery.md)
**Decision:** Resolved (owner decision 2026-10-18): keep current behaviour — only campaigns count.

## Reviews

**BD-058** Does a later customer return remove review eligibility or hide an existing review? (Now: eligibility = order delivered.)
Source: [TASK-044](../tasks/TASK-044-verified-reviews.md)
**Decision:** Resolved (owner decision 2026-10-18): keep current behaviour — eligibility = order delivered; a later return changes nothing.

**BD-059** Review content checks (banned words, links, phone numbers, repeated text) and what happens to a match (reject or hold)?
Now: none beyond rating 1-5, non-blank text, 2000 characters.
Sources: [TASK-044](../tasks/TASK-044-verified-reviews.md), [TASK-061](../tasks/TASK-061-security-review.md)
**Decision:** Resolved (owner decision 2026-10-18): keep current behaviour — no checks beyond rating 1-5, non-blank text, 2000 characters.

**BD-060** Rate-limit numbers for writing/editing/reporting reviews.
Now: none applied.
Sources: [TASK-044](../tasks/TASK-044-verified-reviews.md), [TASK-061](../tasks/TASK-061-security-review.md), API Contract §30
**Decision:** Resolved (owner decision 2026-10-18, "sensible defaults"): per customer per hour, 20 review writes (create and edit share one counter) and 20 reports; over the limit `429 RATE_LIMITED` for 15 minutes with `retryAfterSeconds`.

**BD-061** How is the reviewer shown publicly (none, first name, initials)?
Now: no name.
Source: [TASK-044](../tasks/TASK-044-verified-reviews.md)
**Decision:** Resolved (owner decision 2026-10-18): keep current behaviour — no name shown.

**BD-062** Edit window/limit for reviews, and may moderators dismiss reports without hiding the review?
Now: edits always allowed; only hiding resolves reports.
Source: [TASK-044](../tasks/TASK-044-verified-reviews.md)
**Decision:** Resolved (owner decision 2026-10-18): keep current behaviour — edits always allowed; only hiding resolves reports.

## Analytics

**BD-063** After how long is a checkout without an order "abandoned"?
Now: 24 hours.
Source: [TASK-050](../tasks/TASK-050-analytics-events.md)
**Decision:** Resolved (owner decision 2026-10-18): keep current behaviour — 24 hours.

**BD-064** Analytics event rate limit.
Now: 1000 events per IP per hour.
Source: [TASK-050](../tasks/TASK-050-analytics-events.md)
**Decision:** Resolved (owner decision 2026-10-18): keep current behaviour — 1000 events per IP per hour.

**BD-065** How long are analytics events kept?
Now: forever.
Source: [TASK-050](../tasks/TASK-050-analytics-events.md)
**Decision:** Resolved (owner decision 2026-10-18): keep current behaviour — kept forever.

**BD-066** How do returns/refunds reduce revenue, cost and profit in reports?
Now: they do not.
Sources: [TASK-051](../tasks/TASK-051-analytics-aggregation.md), [ADR-0052](ADR-0052-analytics-aggregation.md)
**Decision:** Resolved (owner decision 2026-10-18): keep current behaviour — returns/refunds do not reduce revenue, cost or profit.

**BD-067** Brand and category performance reports (in User Flows but not built): add in a follow-up task?
Source: [TASK-052A](../tasks/TASK-052A-analytics-employees-home.md)
**Decision:** Resolved (owner decision 2026-10-18): not in v1; a possible follow-up task.

## Security

**BD-068** CAPTCHA (Q157): which provider and when does it trigger (e.g. after N failed logins/OTP sends)? Needs a provider account.
Now: none.
Source: [TASK-061 Open Items](../tasks/TASK-061-security-review.md)
**Decision:** Deferred (owner 2026-10-18): localhost only for now (needs a provider account).

**BD-069** Minimum and maximum for the staff session length settings.
Now: any whole number of minutes above zero.
Sources: [ADR-0054 §5 item 3](ADR-0054-settings-changes-and-admin-screens.md), [TASK-057](../tasks/TASK-057-settings-dashboard.md)
**Decision:** Resolved (owner decision 2026-10-18): keep current behaviour — any whole number of minutes above zero.

## Operations / Backups / Monitoring

**BD-070** Backup retention (how many daily and weekly backups, Q182).
Now: 7 daily / 4 weekly placeholders.
Source: [TASK-064 Open Items](../tasks/TASK-064-backup-recovery.md)
**Decision:** Resolved (owner decision 2026-10-18): keep current behaviour — 7 daily / 4 weekly backups.

**BD-071** Acceptable data loss and recovery time (RPO / RTO).
Now: daily backups, up to 24 hours of loss.
Source: [TASK-064 Open Items](../tasks/TASK-064-backup-recovery.md)
**Decision:** Resolved (owner decision 2026-10-18): keep current behaviour — daily backups, up to 24 hours of data loss (RPO); no RTO target, the drill records restore timings.

**BD-072** How often to run the restore drill (proposed monthly and after major releases)?
Source: [TASK-064 Open Items](../tasks/TASK-064-backup-recovery.md)
**Decision:** Resolved (owner decision 2026-10-18): accepted — monthly and after major releases.

**BD-073** Should the end-to-end test job become a required check before merging?
Source: [TASK-063 Open Items](../tasks/TASK-063-e2e-regression.md)
**Decision:** Resolved (owner decision 2026-10-18): yes, the `e2e` job becomes a required check. The owner must enable it in GitHub branch protection; code does not do this.

**BD-074** Who may view the system status screen?
Now: Owner/Admin (audit-log permission); a dedicated permission is possible.
Source: [TASK-065 Open Items](../tasks/TASK-065-observability.md)
**Decision:** Resolved (owner decision 2026-10-18): keep current behaviour — Owner/Admin through `VIEW_AUDIT_LOGS`.

**BD-075** Who is alerted about failures and when (people, channel, hours)?
Source: [TASK-065 Open Items](../tasks/TASK-065-observability.md)
**Decision:** Deferred (owner 2026-10-18): localhost only for now.

## Website / UX

**BD-076** Show the header announcement bar ("Free shipping over 2,500 EGP, Cash on Delivery across Egypt")? Where does its text come from?
Now: not built.
Source: [TASK-058](../tasks/TASK-058-website-foundation.md)
**Decision:** Resolved (owner decision 2026-10-18): not in v1; keep as is — no announcement bar.

**BD-077** Define "Featured", "Best seller" (manual pick or sales ranking, which period) and "Offers" (which discounts/products).
Now: sorted by newest; "Best Sellers"/"Offers" header links and the "Beauty favorites" row are not built.
Sources: [TASK-059](../tasks/TASK-059-shopping-experience.md), [TASK-059B](../tasks/TASK-059B-storefront-home.md), [TASK-059D](../tasks/TASK-059D-header-checkout-fixes.md)
**Decision:** Resolved (owner decision 2026-10-18): keep current behaviour — sorted by newest; no "Best Sellers"/"Offers" links and no "Beauty favorites" row.

**BD-078** Product badges ("NEW", "RARE FIND", "-20% SALE"), free-shipping progress bar and complimentary gift samples shown in the design: wanted, and by what rule?
Now: not built.
Source: [TASK-059](../tasks/TASK-059-shopping-experience.md)
**Decision:** Resolved (owner decision 2026-10-18): not in v1; keep as is — no badges, free-shipping progress bar or gift samples.

**BD-079** Homepage photography: supply BeautyFits images, or add category images to the catalog?
Now: placeholder gradients.
Source: [TASK-059B](../tasks/TASK-059B-storefront-home.md)
**Decision:** Resolved (owner decision 2026-10-18): keep current behaviour — placeholder gradients until photography is supplied.

**BD-080** May the site claim "100% authentic" and "fast delivery across Egypt"?
Now: not shown.
Source: [TASK-059B](../tasks/TASK-059B-storefront-home.md)
**Decision:** Resolved (owner decision 2026-10-18): keep current behaviour — not shown.

**BD-081** Hero rating line, editorial statistics and testimonials from the design have no data source: provide real content or drop?
Now: not built.
Source: [TASK-059B](../tasks/TASK-059B-storefront-home.md)
**Decision:** Resolved (owner decision 2026-10-18): not in v1; keep as is — not built.

**BD-082** Account page extras from the design: VAT invoice download, membership ID/customer tier, concierge support hours: wanted?
Now: not built.
Source: [TASK-060](../tasks/TASK-060-account-orders-returns.md)
**Decision:** Resolved (owner decision 2026-10-18): not in v1; keep as is — no VAT invoice download, membership ID/tier or concierge hours.

## Other

**BD-083** When an account is deactivated, the active cart is removed; should the wishlist be removed too?
Now: kept.
Source: [TASK-042](../tasks/TASK-042-wishlist.md)
**Decision:** Resolved (owner decision 2026-10-18): keep current behaviour — the wishlist is kept.

**BD-084** Wishlist "move to cart": one unit and removed from the wishlist (now), or customer picks quantity / item stays?
Source: [TASK-042](../tasks/TASK-042-wishlist.md)
**Decision:** Resolved (owner decision 2026-10-18): keep current behaviour — one unit, removed from the wishlist.

**BD-085** Is a separate "Coming Soon" state needed for out-of-stock items (e.g. never received yet)?
Now: one "out of stock" status.
Source: [TASK-042](../tasks/TASK-042-wishlist.md)
**Decision:** Resolved (owner decision 2026-10-18): keep current behaviour — one "out of stock" status.

**BD-086** Mobile app push notifications: wanted? For which events (the transactional WhatsApp ones, marketing with consent?), and where do they rank against WhatsApp and email (Q61)?
Now: no push; channels are WhatsApp and email, plus the in-app list.
Source: [TASK-067](../tasks/TASK-067-mobile-api-readiness.md)
**Decision:** Deferred (owner 2026-10-18): no mobile app for now.

## Deferred (no production hosting, no mobile app for now)

Not open now; revisit when production hosting is chosen or a mobile app is planned.

- BD-068 CAPTCHA provider and trigger (localhost only).
- BD-075 alert recipients, channel and hours (localhost only).
- BD-052 WhatsApp pre-approved campaign templates (provider; localhost only).
- BD-086 mobile push notifications (no mobile app).
- App/universal links for website paths: [TASK-067](../tasks/TASK-067-mobile-api-readiness.md) (no mobile app).
- Hosting provider, and the exact queue, object-storage, email, WhatsApp and monitoring vendors: [Architecture §27](../architecture/system-architecture.md), TASK-064/TASK-065 open items.
- Off-site backup storage target and access: [TASK-064](../tasks/TASK-064-backup-recovery.md). Backups stay local.
- Error-tracking / monitoring vendor: [TASK-065](../tasks/TASK-065-observability.md). Errors stay log lines.
- Production deployment (TASK-066), including the site-wide Content-Security-Policy: [TASK-061](../tasks/TASK-061-security-review.md).

## Already resolved (for reference)

- Customer login identifier: email + password (R13).
- Employee second factor: email OTP, 30-day trusted device (R28).
- Staff session lifetime: 12 h max, 60 min idle (R29).
- Sessions after password reset (R23).
- OTP channel for phone change and guest claim: email (R30, R31).
- Draft product without image allowed; publishing needs a main image ([ADR-0021](ADR-0021-product-media-and-uploads.md)).
- Low-stock threshold per product, variant may override ([ADR-0024](ADR-0024-inventory-ledger.md)).
- Reservations consumed at Shipped; reservations write movements ([ADR-0025](ADR-0025-inventory-reservations.md)).
- Tax: prices tax-inclusive, no rate in v1 (C1, R38).
- Guest marketing consent: not offered at checkout (R38).
- Governorates/areas: managed list (R32).
- Hosting model: long-running Node.js server (ADR-0013); provider deferred above.
- Delivery-failure contact task opens after 2 failed attempts (owner, 2026-10-15).
- Guest claim "nothing to claim" answer is always the same hint (owner, 2026-10-15).
- Inspection that cancels a shipped order uses `INSPECT_RETURN` (owner, 2026-10-15).
- Change-of-mind cancellation after pickup keeps the shipping fee (owner, 2026-10-15).
- Return claim categories and photo requirements; free gifts and opened units on change of mind (owner, 2026-10-15).
- Restock with both channels: WhatsApp first, email only as fallback (owner, 2026-10-15).
- Revenue = confirmed through delivered orders, excluding shipping fee (owner, 2026-10-15).
- Critical settings: minimum margin only; a sole Owner's change applies at once (owner, 2026-10-15).
- First visit opens website and dashboard in Arabic (owner, 2026-10-15).
