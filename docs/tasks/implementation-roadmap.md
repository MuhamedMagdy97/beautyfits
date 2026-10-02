# BeautyFits — Implementation Task Breakdown v1.0

**Status:** Ready for execution planning
**Source of Truth:** `docs/product/business-spec.md` → `docs/product/user-flows.md` → `docs/architecture/system-architecture.md` → `docs/database/database-design.md` → `docs/api/api-contract.md`
**Cross-cutting:** `docs/security/security-requirements.md`, `docs/testing/test-strategy.md`
**Decision ledger (history, not primary source):** `docs/decisions/business-rules-ledger.xlsx`
**Task files:** `docs/tasks/TASK-XXX-*.md`, created from `docs/tasks/task-template.md`
**Development Environment:** VS Code + Claude Code + GitHub
**Execution Rule:** One task at a time. Implement → test → review → commit → merge.

## 1. AI Execution Workflow

For every task:

1. Read `AGENTS.md`.
2. Read only the relevant source-of-truth docs.
3. Inspect the current code and existing conventions.
4. Produce a short implementation plan before editing.
5. Implement only the task scope.
6. Add/update automated tests.
7. Run formatter, lint, typecheck and relevant tests.
8. Self-review for business-rule violations, security issues and regressions.
9. Update documentation when behavior/contracts change.
10. Create a focused Git commit.
11. Human review before merge.

**Agent rule:** Claude Code (the current execution agent) or any other agent may implement or review, but no agent is allowed to invent business behavior. When a requirement is unclear, stop and mark `[BUSINESS DECISION REQUIRED]`.

---

# 2. Phase Map

| Phase | Area | Tasks |
|---|---|---|
| 0 | Foundation | TASK-001 → TASK-006 |
| 1 | Identity & RBAC | TASK-007 → TASK-013 |
| 2 | Catalog | TASK-014 → TASK-018 |
| 3 | Inventory & Purchasing | TASK-019 → TASK-024 |
| 4 | Cart, Pricing & Checkout | TASK-025 → TASK-029 |
| 5 | Orders & COD | TASK-030 → TASK-033 |
| 6 | Shipping | TASK-034 → TASK-036 |
| 7 | Returns & Wallet | TASK-037 → TASK-041 |
| 8 | Wishlist, Reviews & Notifications | TASK-042 → TASK-045 |
| 9 | Marketing | TASK-046 → TASK-049 |
| 10 | Analytics | TASK-050 → TASK-051 |
| 11 | Admin Dashboard | TASK-052 → TASK-057 |
| 12 | Website Integration | TASK-058 → TASK-060 |
| 13 | Hardening & Production | TASK-061 → TASK-067 |

---

# 3. Detailed Task Breakdown

## Phase 0 — Foundation

### TASK-001 — Repository & AI Development Rules
**Depends on:** none

**Goal:** Establish the repository rules and documentation workflow.

**Scope:**
- Create `AGENTS.md`.
- Confirm `docs/` structure and Source-of-Truth order.
- Add `docs/security/security-requirements.md` and `docs/testing/test-strategy.md`.
- Reconcile known documentation inconsistencies and record closure decisions (Business Spec R1–R12).
- Define branch naming and commit conventions.
- Define no-direct-main workflow.
- Define required checks before merge.
- Define how agents update docs and task status.

**Acceptance criteria:**
- Any new AI session can understand where requirements live.
- No business rule may be invented silently.
- `main` is protected from direct feature work.

---

### TASK-002 — Backend Application Bootstrap
**Depends on:** TASK-001

**Goal:** Create the backend application shell without implementing business domains.

**Scope:**
- Application entry point.
- Module boundaries.
- Environment loading.
- Dependency management.
- Health endpoint.
- Graceful shutdown.

**Acceptance criteria:**
- Backend starts locally with one command.
- Health endpoint returns a stable response.
- No business logic in the bootstrap layer.

**Executed as "Project Foundation"** (`docs/tasks/TASK-002-project-foundation.md`): it also laid the foundation slices of TASK-003 (DB client, migration strategy), TASK-005 (error model, request ids, logging, validation, config validation) and TASK-006 (Vitest, scripts). Those tasks complete the remaining scope listed in the TASK-002 task file.

---

### TASK-002A — Documentation Closure v1.2
**Depends on:** TASK-002

**Goal:** Resolve the contradictions and gaps found by the post-TASK-002 audit so implementation can continue safely. Documentation only (`docs/tasks/TASK-002A-docs-closure.md`).

---

### TASK-003 — Database Connection & Migration Foundation
**Depends on:** TASK-002

**Goal:** Connect PostgreSQL and establish migrations.

**Scope:**
- Database connection.
- Migration runner.
- Transaction helper.
- Local database configuration.
- Migration status tooling.

**Acceptance criteria:**
- Clean database can be created entirely from migrations.
- Transaction boundaries are testable.

---

### TASK-004 — Seed & Bootstrap Data
**Depends on:** TASK-003

**Goal:** Make a fresh environment usable without manual database editing.

**Scope:**
- Owner bootstrap flow.
- Default permissions.
- Default roles.
- Default settings.
- Development seed data separated from production bootstrap.

**Acceptance criteria:**
- No public "create admin" endpoint exists.
- Seed data is deterministic.

**Sequencing note (TASK-002A):** the tables this task seeds (accounts, employees, roles, permissions, settings) are created by TASK-011/TASK-012, and the owner bootstrap needs the password hashing from TASK-011. Execute TASK-004 after TASK-012 (or split it: seed tooling now, data after TASK-012).

**Status after TASK-004** (`docs/tasks/TASK-004-seed-bootstrap.md`, ADR-0017): `npm run db:seed` checks the permission rows, inserts the default settings (the `settings` table, starting with the R29 staff session lengths), creates the default roles of catalog §3 and the first Owner from `BOOTSTRAP_OWNER_EMAIL` / `BOOTSTRAP_OWNER_PASSWORD`. `npm run db:seed:dev` adds sample staff for local use. The settings screen and `setting_history` remain with TASK-057.

---

### TASK-005 — Cross-Cutting Backend Foundations
**Depends on:** TASK-002, TASK-003

**Goal:** Establish shared backend behavior.

**Scope:**
- Error model.
- Request IDs.
- Structured logging.
- Validation layer.
- Time handling.
- Money helpers using minor units.
- Response conventions.
- Config validation.

**Acceptance criteria:**
- API errors follow the contract.
- Money cannot be represented inconsistently.
- Sensitive values are not logged.

**Status after TASK-002:** error model, request ids, structured logging, validation, response conventions and config validation are done. Remaining: money helpers (minor units, HALF-UP) and time handling, plus redacting sensitive values inside logged error messages and adding the v1.2 error codes `UNAUTHENTICATED` and `RATE_LIMITED` to `src/server/errors/app-error.ts` (API contract §6.1, §29).

**Remaining scope implemented in TASK-005** (`docs/tasks/TASK-005-cross-cutting-foundations.md`, ADR-0011): money and time helpers, the two error codes, and redaction of secrets inside logged text. Business decisions R20–R22 recorded.

---

### TASK-006 — Test Harness & CI Baseline
**Depends on:** TASK-002 → TASK-005

**Goal:** Make automated verification part of every task.

**Scope:**
- Unit test framework.
- Integration test setup.
- Database test strategy.
- Lint/format/typecheck.
- CI workflow.

**Acceptance criteria:**
- CI can run on a clean checkout.
- Failed tests block merge.

**Status:** implemented in `docs/tasks/TASK-006-ci-baseline.md` (ADR-0012): GitHub Actions CI (`verify`), Prettier, Linux-compatible lockfile. Branch protection on `main` is enabled by the owner.

---

# Phase 1 — Identity & RBAC

### TASK-007 — Customer Authentication Core
**Depends on:** TASK-006

Implement customer registration/login/session lifecycle.

**Acceptance:** secure sessions, logout-all-devices, password hashing, rate limiting.

### TASK-008 — Email OTP & Recovery
**Depends on:** TASK-007

Implement email verification, forgot-password OTP, resend cooldown, expiry and retry limits.

**Status:** implemented in `docs/tasks/TASK-008-email-otp-recovery.md` (ADR-0014). Emails go to a local `.eml` mailbox until a provider is chosen.

### TASK-009 — Customer Profile & Addresses
**Depends on:** TASK-007

Implement profile, multiple addresses, default address, email/phone changes with re-authentication and verification.

### TASK-010 — Guest Identity & Order Claiming
**Depends on:** TASK-009, TASK-030 later for full order linking

Implement secure guest-order claim flow using OTP; do not rely on phone match alone.

### TASK-011 — Employee Authentication & MFA
**Depends on:** TASK-006

Implement employee auth, email OTP challenge with 30-day trusted devices for all employees including Owner/Admin (Business Spec R28), session handling with 12 h / 60 min configurable defaults and reset revoking all sessions (R29), and logout.

**Status after TASK-011** (`docs/tasks/TASK-011-employee-auth.md`): employee login, trusted devices, staff sessions, refresh, logout and recovery are done. Employee invitations (`accept-invitation`, Q64) move to TASK-012; the Owner-configurable session lengths use the settings store of TASK-004/TASK-057.

### TASK-012 — Roles & Granular Permissions
**Depends on:** TASK-011

Implement Owner/Admin/Manager/Employee hierarchy, custom roles, granular permissions and backend authorization, including employee invitations and `POST /employee-auth/accept-invitation` (Q64; moved from TASK-011).

**Status after TASK-012** (`docs/tasks/TASK-012-roles-permissions.md`): roles, the permission catalog table, `requirePermission`, employee management and invitations (including `accept-invitation`) are done. Role, invitation and employee changes are written to the structured logger until `audit_logs` exists (TASK-013). TASK-004 can now seed the first Owner and the default roles.

### TASK-013 — Approval Requests & Audit Logs
**Depends on:** TASK-012

Implement reusable approval request mechanism and immutable-style audit logging for critical actions.

**Status after TASK-013** (`docs/tasks/TASK-013-approvals-audit.md`): `audit_logs` (append-only) and `approval_requests` exist, with `GET /admin/audit-logs` and the `/admin/approval-requests` endpoints. Role, staff and bootstrap changes are audited. Each feature that needs approval (TASK-022, TASK-023, TASK-048, the settings changes of TASK-057) adds its handler in `src/server/modules/approvals/handlers.ts` and audits its own actions with `recordAudit`.

---

# Phase 2 — Catalog

### TASK-014 — Products & Canonical Variants/SKUs
**Depends on:** TASK-012

Implement Product as container and Variant as canonical sellable SKU. Even simple products get a default variant.

### TASK-015 — Brands, Categories & Catalog Relations
**Depends on:** TASK-014

Implement brand/category taxonomy, parent categories and product associations.

### TASK-016 — Product Media & Secure Uploads
**Depends on:** TASK-014

Implement image upload, media validation, main image, dimensions, type/size/security validation, archival behavior.

### TASK-017 — Product Publishing & Archive Lifecycle
**Depends on:** TASK-014 → TASK-016

Implement Draft/Published/Archived/Disabled states and prevent hard deletion.

**Status after TASK-017** (`docs/tasks/TASK-017-product-publishing.md`): `publish`, `unpublish`, `disable` and `archive` exist with their audit entries (ADR-0022). Publishing needs a main image and named variants when there are several; TASK-018 adds its "has a selling price" check to `checkPublishable` in `src/server/modules/catalog/lifecycle.ts`. Cart, wishlist and checkout tasks treat only `PUBLISHED` products as purchasable.

### TASK-018 — Pricing & Cost Model
**Depends on:** TASK-014, TASK-019 later for stock/cost integration

Implement selling price, latest purchase cost, weighted average cost, margin warning and price history/audit.

**Status after TASK-018** (`docs/tasks/TASK-018-pricing-cost.md`): variants carry `selling_price`, `latest_purchase_cost`, `weighted_average_cost` (ADR-0023). Prices change through `POST /admin/products/{id}/price-review`; costs are typed by hand only until `product_variants.first_goods_receipt_at` is set. TASK-023 sets that column and updates both costs with `nextWeightedAverageCost` in `src/server/modules/catalog/pricing.ts`; the cart/checkout tasks read `selling_price`; orders store `unit_cost_at_sale` from `weighted_average_cost`.

---

# Phase 3 — Inventory & Purchasing

### TASK-019 — Inventory Ledger & Balances
**Depends on:** TASK-014

Implement Available, Reserved, Damaged and Inventory Movement ledger.

**Status after TASK-019** (`docs/tasks/TASK-019-inventory-ledger.md`): every variant has an `inventory_balances` row; stock changes only by inserting an `inventory_movements` row (one delta per quantity), applied by a database trigger that keeps every quantity ≥ 0 (ADR-0024). Manual adjustments, the overview, movements and low stock (product threshold, variant override) exist. TASK-020 locks the balance row (`SELECT … FOR UPDATE`) and inserts reservation/release movements, adding its movement types to `inventory_movement_type`; TASK-023 inserts `PURCHASE_RECEIPT` movements with `unit_cost`.

### TASK-020 — Inventory Reservation Engine
**Depends on:** TASK-019

Implement atomic reservation, release, concurrency-safe updates and oversell prevention.

**Status after TASK-020** (`docs/tasks/TASK-020-inventory-reservations.md`): `reserveForOrder`, `releaseForOrder` and `commitForOrder` in `src/server/modules/inventory/reservations.ts` run inside the caller's transaction (ADR-0025). Reserving is all or nothing (`STOCK_CHANGED`), locks balances in variant id order and writes `RESERVATION` movements; release (cancel/expiry) and commit (at `SHIPPED`, owner decision) are idempotent. TASK-029 reserves in the checkout transaction; TASK-031/TASK-033 release; the shipping task commits; TASK-030 adds the `inventory_reservations.order_id` foreign key.

### TASK-021 — Suppliers
**Depends on:** TASK-012

Implement supplier records, contacts, active state and historical relationships.

### TASK-022 — Purchase Orders & Approval
**Depends on:** TASK-021, TASK-013

Implement Draft → Pending Approval → Approved → Sent lifecycle with role/approval rules.

### TASK-023 — Goods Receiving & Supplier Invoices
**Depends on:** TASK-022, TASK-019

Implement delivery inspection, short/over receipt, goods receipt records and immutable supplier invoice records.

### TASK-024 — Supplier Returns, Payments & Ledger
**Depends on:** TASK-023

Implement supplier returns, supplier credits/refunds, supplier balances, payments and financial ledger entries.

---

# Phase 4 — Cart, Pricing & Checkout

### TASK-025 — Guest & Customer Cart
**Depends on:** TASK-014, TASK-019

Implement cart lifecycle for Guest and authenticated Customer.

### TASK-026 — Discount Engine
**Depends on:** TASK-018, TASK-025

Implement percentage discounts, targeting, minimum order, max discount, overall/per-customer usage, single-discount-per-order selection and checkout revalidation.

### TASK-027 — Shipping Rules & Free Shipping Engine
**Depends on:** TASK-014, TASK-025

Implement company/area/order-value rules and final-total-based free shipping threshold.

### TASK-028 — Wallet Ledger & Reservation
**Depends on:** TASK-007, TASK-026

Implement wallet balance, immutable transactions, wallet reservations and Wallet + COD split.

### TASK-029 — Atomic Checkout Engine
**Depends on:** TASK-020, TASK-025 → TASK-028

Implement the critical checkout transaction: revalidate cart, prices, discount, shipping, wallet, stock; reserve inventory; create order; use idempotency; commit; then emit background events.

---

# Phase 5 — Orders & COD

### TASK-030 — Order Core & Historical Snapshots
**Depends on:** TASK-029

Implement order creation, order items, product/address/price/tax snapshots, status history and immutable historical facts.

### TASK-031 — COD Confirmation
**Depends on:** TASK-030, TASK-045 later for provider abstraction

Implement configurable confirmation channel, reminder schedule, 3-day hard maximum, Expired transition and reservation release.

### TASK-032 — Order Modification & Re-confirmation
**Depends on:** TASK-030, TASK-031

Allow edits before Preparing. Material changes recalculate everything and require customer re-confirmation. Preserve revisions.

### TASK-033 — Cancellation & Expiration
**Depends on:** TASK-030 → TASK-032

Implement cancellation rules before carrier pickup, shipping-cancellation request after pickup, and Expired behavior.

---

# Phase 6 — Shipping

### TASK-034 — Shipment & Tracking Core
**Depends on:** TASK-030

Implement shipment records, tracking number, carrier assignment, shipment status and events.

### TASK-035 — Delivery Failure & Attempts
**Depends on:** TASK-034

Track delivery attempts/failures and create customer-contact tasks after configured threshold.

### TASK-036 — Shipping Cancellation & Return-to-Sender
**Depends on:** TASK-033, TASK-034

Implement Shipping Cancellation Requested → Return to Sender/Returned → Cancelled flow and associated inventory/wallet effects.

---

# Phase 7 — Returns & Wallet

### TASK-037 — Customer Return Requests
**Depends on:** TASK-030, TASK-034

Implement 14-day eligibility, free-text reason, evidence rules and Pending Approval state.

### TASK-038 — Return Approval & Carrier Pickup
**Depends on:** TASK-037

Admin review, approval/rejection, carrier pickup request and shipping responsibility rules.

### TASK-039 — Return Receiving & Inspection
**Depends on:** TASK-038

Implement Received → Inspecting and per-item outcomes: Restock/Damaged/Rejected, with notes and evidence.

### TASK-040 — Refund Calculation & Resolution Rules
**Depends on:** TASK-039, TASK-028

Implement full/partial refunds, customer-caused 25% wallet outcome (Business Spec R7), return shipping responsibility, original delivery fee rules and manual exception workflow.

### TASK-041 — Wallet Refund Completion
**Depends on:** TASK-040

Post-inspection wallet refunds, partial refunds, wallet transactions and reservation release/consumption rules.

---

# Phase 8 — Wishlist, Reviews & Notifications

### TASK-042 — Wishlist
**Depends on:** TASK-009, TASK-014

Account-only wishlist, unavailable/Coming Soon behavior and move-to-cart support.

### TASK-043 — Restock / Notify Me & Wishlist Reminders
**Depends on:** TASK-042, TASK-045

Implement explicit restock subscriptions, one notification per restock event, and wishlist purchase reminders with cadence, maximum, stopping conditions and consent checks per Business Spec R6.

### TASK-044 — Verified Reviews
**Depends on:** TASK-030, TASK-014

Implement one review per successful purchase/order, product-level review display, direct publishing after automated abuse checks and moderation/hide history.

### TASK-045 — Notification Service
**Depends on:** TASK-005, TASK-007

Implement in-app notification center, read/unread, transactional notifications, Email/WhatsApp provider abstraction, fallback only when the fallback channel is authorized, delivery attempts and logs.

---

# Phase 9 — Marketing

### TASK-046 — Marketing Consent Ledger
**Depends on:** TASK-009, TASK-045

Implement explicit opt-in, opt-out, timestamps, source, per-channel preferences and consent history/retention.

### TASK-047 — Customer Segmentation
**Depends on:** TASK-030, TASK-046, TASK-050 later for analytics data

Implement MVP segments: all opted-in, previous buyers, product/brand/category buyers, inactive customers, high-spending customers.

### TASK-048 — Campaign Authoring & Approval
**Depends on:** TASK-046, TASK-047

Draft → Pending Approval → Approved → Sending → Completed/Failed campaign lifecycle.

### TASK-049 — Marketing Delivery, Frequency & Fallbacks
**Depends on:** TASK-048, TASK-045

Implement frequency limits, delivery retries, consent-aware fallback and complete campaign delivery logs.

---

# Phase 10 — Analytics

### TASK-050 — Analytics Event Collection
**Depends on:** TASK-025, TASK-030

Capture anonymous/customer Product View, Add to Cart, Checkout Start, Checkout Abandonment and Order events.

### TASK-051 — Analytics Aggregation & Profit Metrics
**Depends on:** TASK-050, TASK-018, TASK-030

Implement dashboards for revenue, orders, customers, views, conversion funnel, COGS, estimated gross profit, AOV and product performance.

---

# Phase 11 — Admin Dashboard

### TASK-052 — Dashboard Shell & Permission-aware Navigation
**Depends on:** TASK-012, backend modules stable enough for initial integration

Implement layout, authentication, permission-aware navigation, session handling and error states.

### TASK-053 — Catalog & Inventory Dashboard
**Depends on:** TASK-014 → TASK-020

Products, variants, categories, brands, media, inventory balances, movements and low-stock alerts.

### TASK-054 — Orders, Customers & Returns Dashboard
**Depends on:** TASK-030 → TASK-041

Order queues, status transitions, customer details, cancellation, return approval, inspection and refund handling.

### TASK-055 — Purchasing & Shipping Dashboard
**Depends on:** TASK-021 → TASK-036

Suppliers, purchase orders, approvals, receiving, invoices, supplier returns, carriers, tracking and delivery events.

### TASK-056 — Wallet, Marketing & Notifications Dashboard
**Depends on:** TASK-041 → TASK-049

Wallet views/controlled adjustments, campaign management, consent views, notification delivery logs and marketing approvals.

### TASK-057 — Settings, Roles, Approvals & Audit Dashboard
**Depends on:** TASK-012, TASK-013, TASK-052

System settings, critical setting approvals, employee roles, permissions, approval queue and audit log viewer.

---

# Phase 12 — Website Integration

### TASK-058 — Existing Website API Integration Foundation
**Depends on:** TASK-029, TASK-030 and required catalog/auth APIs

Connect the Next.js website in this repository to the backend without rewriting the UI unnecessarily. Note: as of TASK-001 the repository contains a Next.js starter project, not a completed BeautyFits storefront, so storefront UI will need to be built; it stays at the repository root unless a task explicitly moves it.

### TASK-059 — Customer Shopping Experience Integration
**Depends on:** TASK-058

Products, search, product detail, cart, checkout, account, addresses, wishlist and reviews.

### TASK-060 — Order Tracking & Returns Integration
**Depends on:** TASK-058, TASK-034 → TASK-041

Customer order timeline, cancellation rules, shipping tracking, return request, return status and wallet.

---

# Phase 13 — Hardening & Production

### TASK-061 — Security Review & Abuse Controls
**Depends on:** all feature phases

Review authentication, authorization, rate limiting, OTP abuse, file uploads, secrets, PII logging, CORS/CSRF, session handling and sensitive permissions.

### TASK-062 — Concurrency & Reliability Tests
**Depends on:** TASK-029, TASK-020, TASK-028, TASK-040

Stress critical races: last-stock checkout, duplicate checkout, wallet double-spend, duplicate webhook, repeated refund request and concurrent edits.

### TASK-063 — End-to-End Regression Suite
**Depends on:** dashboard + website integration

Automate high-value customer/admin flows from browse to checkout, delivery, return and refund.

### TASK-064 — Backup & Disaster Recovery Validation
**Depends on:** production-like environment

Automated backups, retention, restore drill, verification and documented recovery procedure.

### TASK-065 — Observability & Monitoring
**Depends on:** TASK-005 and feature completion

Error tracking, structured logs, background job monitoring, key metrics and alerting.

### TASK-066 — Production Deployment
**Depends on:** TASK-061 → TASK-065

Production environment, secrets, migrations, health checks, deployment, rollback strategy and smoke tests.

### TASK-067 — Mobile API Readiness Review
**Depends on:** TASK-060, TASK-063

Verify that the API contract supports the future mobile app without duplicating business logic or introducing mobile-only rules.

---

# 4. Critical Execution Dependencies

The first implementation chain is intentionally strict:

```text
TASK-001
  ↓
TASK-002
  ↓
TASK-003
  ↓
TASK-004
  ↓
TASK-005
  ↓
TASK-006
  ↓
TASK-007 / TASK-011
  ↓
TASK-012
  ↓
TASK-014
  ↓
TASK-019
  ↓
TASK-025
  ↓
TASK-029
  ↓
TASK-030
```

Do not start checkout before authentication, catalog, inventory and wallet foundations are stable.

---

# 5. Definition of Done — Every Task

A task is not complete until all are true:

- Requirements from source-of-truth docs are satisfied.
- No unapproved business rule was introduced.
- Validation and authorization exist where required.
- Relevant automated tests exist.
- Edge cases listed in the task are covered.
- Lint/typecheck/format pass.
- Relevant integration tests pass.
- Documentation/API/schema changed by the task are updated.
- No unrelated refactor is mixed in.
- Git commit is focused and understandable.

---

# 6. Human Approval Gates

The user/product owner reviews before moving across these gates:

1. Foundation complete.
2. Auth/RBAC complete.
3. Catalog + Inventory complete.
4. Checkout + Orders complete.
5. Returns + Wallet complete.
6. Dashboard core complete.
7. Website integration complete.
8. Production readiness complete.

---

# 7. Next Immediate Task

**TASK-002A — Documentation Closure v1.2** (`docs/tasks/TASK-002A-docs-closure.md`)

TASK-001 and TASK-002 are merged. Before TASK-003, resolve the documentation contradictions and gaps found by the 2026-09-30 audit.
