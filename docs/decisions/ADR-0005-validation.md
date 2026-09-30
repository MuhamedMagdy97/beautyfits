# ADR-0005 — Server-side validation with zod

- **Status:** Accepted (TASK-002)
- **Date:** 2026-09-30
- **Relates to:** Architecture §1.4; API Contract §2, §30; Security Requirements §6

## Decision

- **zod 4** is the validation library for every server input: body, query, route params, and headers where relevant.
- Routes use the helpers in `src/server/http/validation.ts`:
  - `parseJsonBody(request, schema)`: malformed JSON produces `VALIDATION_ERROR`;
  - `parseQuery(request, schema)`: repeated keys become arrays, and numeric values use `z.coerce`;
  - `parseWith(schema, value)`: for params or any other value.
- A failure throws `AppError("VALIDATION_ERROR")` (HTTP 400) with
  `details.issues: [{ path, code, message }]`, where `path` is dot-separated (for example `items.0.qty`).
- Schemas live with the module that owns the input (`src/server/modules/<module>/…`). Business-level validation (stock, price, permissions, state transitions) happens in module services and uses the specific contract error codes, not `VALIDATION_ERROR`.
- Client code may reuse the same schemas for UX, but the server never trusts client validation or client-supplied authoritative values (prices, totals, stock, permissions, balances).
- Object schemas should be strict about unknown keys on mutation endpoints (`z.strictObject`) unless the contract says otherwise. That way clients cannot smuggle fields such as `price` or `total`.
