# BeautyFits

A beauty e-commerce platform. One authoritative backend and PostgreSQL database serve the Website, the Admin Dashboard, and a future Mobile App.

- Contributor/agent rules: [`AGENTS.md`](AGENTS.md)
- Requirements (source of truth): [`docs/`](docs/). Start with `docs/product/business-spec.md`.
- Technical decisions: [`docs/decisions/`](docs/decisions/README.md)

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · PostgreSQL · Prisma ORM 7 · zod · Vitest.
The backend lives in `src/server/**` and is served under `/api/v1` ([ADR-0001](docs/decisions/ADR-0001-backend-placement.md)).

## Getting started

Requirements: Node.js ≥ 20.19, npm, and Docker (for the local database) or any PostgreSQL 15+ instance.

```bash
npm install                 # also generates the Prisma client (postinstall)
cp .env.example .env        # local development values only
docker compose up -d        # local PostgreSQL on 127.0.0.1:5432
npm run dev                 # http://localhost:3000
```

Check the API:

- `GET http://localhost:3000/api/v1/health` returns liveness
- `GET http://localhost:3000/api/v1/health/ready` returns readiness (database reachable)

There are no database tables yet. Migrations start with TASK-003 ([ADR-0003](docs/decisions/ADR-0003-database-access-and-migrations.md)).

## Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build / server (drains in-flight requests on SIGTERM) |
| `npm run lint` | ESLint |
| `npm run typecheck` | Next.js route type generation + TypeScript (`tsc --noEmit`) |
| `npm test` / `npm run test:watch` | Vitest unit tests |

Before committing, run `lint`, `typecheck`, `test` and, when application code changed, `build` (see `docs/testing/test-strategy.md`).
