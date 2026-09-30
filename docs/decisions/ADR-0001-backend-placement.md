# ADR-0001 — Backend placement and module boundaries

- **Status:** Accepted (TASK-002)
- **Date:** 2026-09-30
- **Relates to:** System Architecture §3, §4, §26, §27 ("Exact backend framework"); Business Spec R8

## Context

The architecture requires one authoritative backend API (a modular monolith) that serves the Website, the Admin Dashboard, and the future Mobile App. The repository contains one Next.js 16 app at the root, which must not be moved into `apps/web` unless a task requires it (R8). The target `apps/*`/`packages/*` shape in Architecture §3 is aspirational. The API contract is framework-neutral and versioned under `/api/v1`.

Options considered:

1. **Separate backend app** (Express/Fastify/NestJS in `apps/api`). This forces a monorepo now, which the architecture does not require yet. It also means a second deployable, a second build toolchain, and a second place for configuration.
2. **Backend inside the root Next.js app, behind a framework-agnostic boundary.** Route Handlers act as thin HTTP adapters, and business logic lives in plain TypeScript modules.

## Decision

Option 2.

```text
src/
├── app/                      # Next.js App Router (website UI; admin UI later)
│   └── api/v1/**/route.ts    # HTTP adapters only: validate → call module → respond
├── server/                   # The backend. No React/Next imports in domain code.
│   ├── config/               # Validated environment (ADR-0007)
│   ├── db/                   # Prisma client (ADR-0003)
│   ├── errors/               # AppError + contract error codes (ADR-0004)
│   ├── http/                 # Envelope, request ids, validation, route wrapper
│   ├── logging/              # Structured logger (ADR-0006)
│   ├── health/               # Liveness/readiness
│   └── modules/<module>/     # Business modules (auth, catalog, …) from TASK-007 on
└── generated/prisma/         # Generated client (gitignored)
```

Rules:

- **All clients use `/api/v1`.** That covers the Website, the Dashboard, and Mobile. Website server components may call `src/server/modules/*` services directly for reads, but must go through the same service functions the API uses, never through Prisma or duplicated logic.
- **Route handlers stay thin.** They are wrapped with `withApi`, validate input with zod, call one module service, and return `ok(...)`. They contain no business rules.
- **Modules own their data.** A module never touches another module's tables directly; it calls that module's exported service functions (Architecture §4).
- **Framework independence.** `src/server/modules/**` and the shared kernel must not import from `next/*` or React. That keeps a later extraction into `apps/api` mechanical if scale ever requires it.
- **Graceful shutdown.** Rely on `next start`, which on `SIGTERM`/`SIGINT` stops accepting connections and drains in-flight requests (Next.js self-hosting guide). The deployment platform must allow a 10–30 s drain period. No custom signal handlers: in the App Router they are not supported, and PostgreSQL releases closed connections.
- **Background workers** (Architecture §11) are a separate entry point that reuses `src/server/**`. The queue technology is chosen by the first task that needs it (TASK-031/TASK-045).

## Consequences

- One deployable, one toolchain, one config.
- The Admin Dashboard can live in the same app (for example a `src/app/(admin)` route group) or move out later. Either way it consumes `/api/v1`.
- The app stays at the repository root, and no monorepo is introduced.
- The boundary relies on convention and review, not tooling. Revisit an ESLint import-boundary rule if violations appear.
