# `src/server`: BeautyFits backend

The backend modular monolith. See `docs/decisions/ADR-0001-backend-placement.md`.

| Path | Responsibility |
|---|---|
| `config/` | `getEnv()`: the only way to read configuration (ADR-0007) |
| `db/` | `getDb()`: the Prisma client (ADR-0003) |
| `errors/` | `AppError` and the API contract error codes (ADR-0004) |
| `http/` | `withApi`, response envelopes, request ids, zod input helpers, client IP, `Accept-Language` (ADR-0004, ADR-0005, ADR-0013) |
| `email/` | Outgoing email port; local `.eml` mailbox transport (ADR-0014) |
| `storage/` | File storage port; local directory storage (`MEDIA_DIR`, ADR-0021) |
| `rate-limit/` | PostgreSQL-backed throttling counters (ADR-0013) |
| `logging/` | Structured logger with redaction (ADR-0006) |
| `money/` | Integer minor-unit money and HALF-UP rounding (ADR-0011) |
| `time/` | UTC instants, `Clock`, Africa/Cairo calendar days (ADR-0011) |
| `health/` | Liveness and readiness checks |
| `modules/auth/` | Customer authentication: accounts, sessions, tokens, password policy, guard (TASK-007, ADR-0008, ADR-0013); email codes, verification and password recovery (TASK-008, ADR-0014) |
| `modules/<module>/` | Business modules (added from TASK-007 onward) |

Rules:

- Server code only. Never import it from client components.
- No `next/*` or React imports in `modules/**` or the shared kernel. The `http/` helpers use only Web `Request`/`Response`.
- A module owns its tables and exposes service functions. Other modules call those functions, never its tables.
- Route handlers in `src/app/api/v1/**` stay thin: `withApi` → validate → call one service → `ok(...)`.
