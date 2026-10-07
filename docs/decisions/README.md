# Decisions

- `business-rules-ledger.xlsx` is the business decision history (Q1–Q185, closure decisions). It is not the primary implementation source; see AGENTS.md.
- `ADR-XXXX-*.md` files are Architecture Decision Records for technical, architecture, and dependency decisions. They never change business rules.

| ADR | Title | Task |
|---|---|---|
| [ADR-0001](ADR-0001-backend-placement.md) | Backend placement and module boundaries | TASK-002 |
| [ADR-0002](ADR-0002-dependency-baseline.md) | Dependency baseline | TASK-002 |
| [ADR-0003](ADR-0003-database-access-and-migrations.md) | Database access (Prisma 7) and migration strategy | TASK-002 |
| [ADR-0004](ADR-0004-api-foundation.md) | API foundation: envelope, errors, request ids, health | TASK-002 |
| [ADR-0005](ADR-0005-validation.md) | Server-side validation with zod | TASK-002 |
| [ADR-0006](ADR-0006-logging.md) | Structured logging | TASK-002 |
| [ADR-0007](ADR-0007-environment-configuration.md) | Environment and configuration | TASK-002 |
| [ADR-0008](ADR-0008-authentication-architecture.md) | Authentication architecture (first-party, session-based) | TASK-002 |
| [ADR-0009](ADR-0009-testing-foundation.md) | Testing foundation (Vitest) | TASK-002 |
| [ADR-0010](ADR-0010-ids-transactions-integration-tests.md) | UUIDv7 ids, transaction helper, integration tests | TASK-003 |
| [ADR-0011](ADR-0011-money-and-time.md) | Money and time helpers | TASK-005 |
| [ADR-0012](ADR-0012-formatting-and-ci.md) | Formatting (Prettier) and CI (GitHub Actions) | TASK-006 |
| [ADR-0013](ADR-0013-customer-auth-sessions-throttling.md) | Customer auth: tokens, transport, CSRF, throttling and client IP (amends ADR-0008) | TASK-007 |
| [ADR-0014](ADR-0014-email-otp-and-recovery.md) | One-time codes, local email delivery and password recovery | TASK-008 |
| [ADR-0015](ADR-0015-employee-auth.md) | Employee login: email codes, trusted devices and staff sessions | TASK-011 |
| [ADR-0016](ADR-0016-roles-permissions-invitations.md) | Roles, permission checks and employee invitations | TASK-012 |
| [ADR-0017](ADR-0017-bootstrap-and-settings.md) | Bootstrap, default roles and the settings table | TASK-004 |
| [ADR-0018](ADR-0018-audit-logs-and-approvals.md) | Audit logs and approval requests | TASK-013 |
| [ADR-0019](ADR-0019-products-and-variants.md) | Products and variants | TASK-014 |
| [ADR-0020](ADR-0020-brands-and-categories.md) | Brands and categories | TASK-015 |
| [ADR-0021](ADR-0021-product-media-and-uploads.md) | Product media and secure uploads | TASK-016 |
| [ADR-0022](ADR-0022-product-lifecycle.md) | Product publishing and archive lifecycle | TASK-017 |
| [ADR-0023](ADR-0023-pricing-and-costs.md) | Selling prices and costs | TASK-018 |
| [ADR-0024](ADR-0024-inventory-ledger.md) | Inventory ledger and balances | TASK-019 |
| [ADR-0025](ADR-0025-inventory-reservations.md) | Inventory reservations | TASK-020 |
| [ADR-0026](ADR-0026-suppliers.md) | Suppliers | TASK-021 |
| [ADR-0027](ADR-0027-purchase-orders.md) | Purchase orders and approval | TASK-022 |
| [ADR-0028](ADR-0028-goods-receiving.md) | Goods receiving and supplier invoices | TASK-023 |
| [ADR-0029](ADR-0029-supplier-returns-ledger.md) | Supplier returns, payments and ledger | TASK-024 |
| [ADR-0030](ADR-0030-customer-profile-addresses-locations.md) | Customer profile, addresses and locations | TASK-009 |
| [ADR-0031](ADR-0031-cart.md) | Guest and customer cart | TASK-025 |
| [ADR-0032](ADR-0032-discounts.md) | Discount engine | TASK-026 |
| [ADR-0033](ADR-0033-shipping-rules.md) | Shipping rules and free shipping | TASK-027 |
| [ADR-0034](ADR-0034-wallet.md) | Wallet ledger and reservations | TASK-028 |
| [ADR-0035](ADR-0035-checkout.md) | Atomic checkout and order creation | TASK-029 |
| [ADR-0036](ADR-0036-order-core.md) | Order core: reads, state machine and immutable snapshots | TASK-030 |
| [ADR-0037](ADR-0037-cod-confirmation.md) | COD confirmation, reminders and expiry | TASK-031 |
| [ADR-0043](ADR-0043-notification-service.md) | Notification service: in-app centre, outbox dispatch and channel fallback | TASK-045 |

New ADRs use the next number, state their status, context, decision and consequences, and are listed here.
