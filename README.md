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

## Database

```bash
npm run db:migrate          # apply migrations to the local database (and create a new one after a schema change: npm run db:migrate -- --name <change>)
npm run db:status           # show which migrations are applied
npm run db:reset            # DEVELOPMENT ONLY: drop all local data and re-apply migrations
npm run db:deploy           # apply committed migrations (CI / staging / production)
```

Migrations live in `prisma/migrations/` and are committed to Git ([ADR-0003](docs/decisions/ADR-0003-database-access-and-migrations.md), [ADR-0010](docs/decisions/ADR-0010-ids-transactions-integration-tests.md)).

## Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build / server (drains in-flight requests on SIGTERM) |
| `npm run lint` | ESLint |
| `npm run typecheck` | Next.js route type generation + TypeScript (`tsc --noEmit`) |
| `npm test` / `npm run test:watch` | Vitest unit tests (no database) |
| `npm run test:integration` | Integration tests against a real PostgreSQL test database (Docker must be running) |
| `npm run db:migrate` / `db:status` / `db:reset` / `db:deploy` | Database migrations |

Before committing, run `lint`, `typecheck`, `test`, `test:integration` when database code changed, and `build` when application code changed (see `docs/testing/test-strategy.md`).
