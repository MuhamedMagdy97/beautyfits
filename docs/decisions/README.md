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

New ADRs use the next number, state their status, context, decision and consequences, and are listed here.
