# ADR-0004 — API foundation: envelope, errors, request ids, health

- **Status:** Accepted (TASK-002)
- **Date:** 2026-09-30
- **Relates to:** API Contract §3, §5, §6, §29; Architecture §25

## Decision

**Base path.** All endpoints live under `/api/v1` (`src/app/api/v1/**/route.ts`). The contract writes paths relative to this base (for example `/auth/login` is `/api/v1/auth/login`). Unknown `/api/v1/*` paths return the standard `NOT_FOUND` error envelope, not an HTML page.

**Route wrapper.** Every route handler is wrapped with `withApi` (`src/server/http/route-handler.ts`), which:

1. resolves the request id: a well-formed incoming `X-Request-Id` (8–128 chars of `[A-Za-z0-9._:-]`) is kept, otherwise a UUID is generated. It is echoed in the `X-Request-Id` response header and `meta.requestId` / `error.requestId`;
2. provides a request-scoped logger bound to `requestId`;
3. maps `AppError` to the contract error envelope and its HTTP status;
4. maps any other thrown value to `500 INTERNAL_ERROR` with a generic message. The original error is logged server-side and never returned;
5. writes one access-log line (method, path without query string, status, duration).

**Envelopes** (`src/server/http/response.ts`) follow API Contract §6 exactly: `{ data, meta: { requestId, pagination? } }` and `{ error: { code, message, details, requestId } }`. API responses are sent with `Cache-Control: no-store`.

**Error model** (`src/server/errors/app-error.ts`). `AppError(code, message, { details })` uses only the codes in API Contract §29. They are typed, so an unknown code does not compile. Default HTTP statuses are recorded in API Contract §6.1. The message and details of an `AppError` are client-visible and must not contain secrets or internal data.

**Health.** These operational endpoints are outside the business contract:

- `GET /api/v1/health` is **liveness**. It always returns `200 { data: { status: "ok" } }` and checks no dependencies.
- `GET /api/v1/health/ready` is **readiness**. It returns `200` with `status: "ready"` when a database ping succeeds within 2 s, and otherwise `503` with `status: "not_ready"` and `checks.database: "down"`. It never exposes connection details.

## Consequences

- Clients can rely on one error shape for every API failure, including unknown routes and crashes.
- Authentication, rate limiting, and idempotency are added to `withApi` or composed around it by their owning tasks (TASK-007, TASK-011, TASK-029). They are not part of this foundation.
