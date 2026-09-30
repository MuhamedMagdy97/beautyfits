# ADR-0006 — Structured logging

- **Status:** Accepted (TASK-002)
- **Date:** 2026-09-30
- **Relates to:** Architecture §25; Security Requirements §9; AGENTS.md Security

## Decision

A small first-party structured logger (`src/server/logging/logger.ts`) rather than a logging library.

- Output is one JSON object per line: `time` (ISO-8601 UTC), `level`, `msg`, `service`, bound context (for example `requestId`), and fields. `info`/`debug` go to stdout; `warn`/`error` go to stderr. The hosting platform collects the streams.
- Levels are `debug | info | warn | error`, controlled by `LOG_LEVEL` (default `info`).
- **Redaction.** Keys matching password/passphrase, otp, token, secret, authorization, cookie, api key, session, credential, private key, hash, database URL, or connection string are replaced with `[REDACTED]` at any depth before serialization. This is a safety net: callers still must not log sensitive customer data (phone, address, and so on) unless it is needed.
- `Error` values are serialized as `{ name, message, stack, code?, cause? }`, and `bigint` values as strings.
- Access logs record the path without the query string, because queries may contain personal data.
- `logger.child({ ... })` binds context. `withApi` provides a request-scoped child with `requestId`.

Why not pino or winston: the requirements (JSON lines, levels, redaction, child bindings) fit in about 100 lines with no dependency and no bundler special-casing inside Next.js. If log volume or transports (for example shipping to a vendor) justify it, TASK-065 may swap the implementation behind the same `Logger` interface.

## Consequences

- Error tracking and monitoring vendors remain deferred to TASK-065.
- Tests assert that sensitive keys are redacted (`logger.test.ts`).
