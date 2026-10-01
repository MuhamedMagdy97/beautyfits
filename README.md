# BeautyFits

A beauty e-commerce platform. One authoritative backend and PostgreSQL database serve the Website, the Admin Dashboard, and a future Mobile App.

- Contributor/agent rules: [`AGENTS.md`](AGENTS.md)
- Requirements (source of truth): [`docs/`](docs/). Start with `docs/product/business-spec.md`.
- Technical decisions: [`docs/decisions/`](docs/decisions/README.md)

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · PostgreSQL · Prisma ORM 7 · zod · Vitest.
The backend lives in `src/server/**` and is served under `/api/v1` ([ADR-0001](docs/decisions/ADR-0001-backend-placement.md)).

## Getting started

Requirements: Node.js 24 (`.nvmrc`; minimum 20.19), npm, and Docker (for the local database) or any PostgreSQL 15+ instance.

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
npm run db:seed             # bootstrap: default settings, default roles, first Owner (safe to re-run)
npm run db:seed:dev         # DEVELOPMENT ONLY: bootstrap + two sample staff accounts
```

### First Owner sign-in

There is no sign-up for staff and no "create admin" endpoint ([ADR-0017](docs/decisions/ADR-0017-bootstrap-and-settings.md)). On a new database:

1. Put the Owner's details in `.env`: `BOOTSTRAP_OWNER_EMAIL`, `BOOTSTRAP_OWNER_PASSWORD` (at least 12 characters) and optionally `BOOTSTRAP_OWNER_NAME`.
2. `npm run db:migrate`, then `npm run db:seed`. It prints "Owner account created".
3. Remove `BOOTSTRAP_OWNER_PASSWORD` from `.env`. Running the seed again never changes an existing Owner.
4. Sign in: `POST /api/v1/employee-auth/login` with `{ "email", "password" }` returns a `loginTicket`; the 6-digit code is in the newest file in `.mail/`; `POST /api/v1/employee-auth/verify-otp` with `{ "loginTicket", "code" }` signs in and trusts the device for 30 days.

The Owner then invites the other staff (`POST /api/v1/admin/employees`). The dashboard screens come later (TASK-052 onward).

Uploaded files such as product images are stored in `.media/` (`MEDIA_DIR`) until a storage provider is chosen ([ADR-0021](docs/decisions/ADR-0021-product-media-and-uploads.md)). Include that folder in backups along with the database.

Migrations live in `prisma/migrations/` and are committed to Git ([ADR-0003](docs/decisions/ADR-0003-database-access-and-migrations.md), [ADR-0010](docs/decisions/ADR-0010-ids-transactions-integration-tests.md)).

## Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Development server (`server.mjs --dev`) |
| `npm run build` / `npm start` | Production build / server (`server.mjs`: a thin custom server that passes the client IP to the backend and drains in-flight requests on SIGTERM, [ADR-0013](docs/decisions/ADR-0013-customer-auth-sessions-throttling.md)). Do not use `next start` in production. |
| `npm run lint` | ESLint |
| `npm run format` / `npm run format:check` | Prettier: format the code / check formatting (CI) |
| `npm run typecheck` | Next.js route type generation + TypeScript (`tsc --noEmit`) |
| `npm test` / `npm run test:watch` | Vitest unit tests (no database) |
| `npm run test:integration` | Integration tests against a real PostgreSQL test database (Docker must be running) |
| `npm run db:migrate` / `db:status` / `db:reset` / `db:deploy` | Database migrations |
| `npm run db:seed` / `db:seed:dev` | Production bootstrap / development sample data ([ADR-0017](docs/decisions/ADR-0017-bootstrap-and-settings.md)) |

Before committing, run `lint`, `format:check`, `typecheck`, `test`, `test:integration` and `build` (see `docs/testing/test-strategy.md`).

## Continuous integration

GitHub Actions (`.github/workflows/ci.yml`, [ADR-0012](docs/decisions/ADR-0012-formatting-and-ci.md)) runs the same checks on every pull request and push to `main`, on a clean checkout with a PostgreSQL 17 service container. Do not merge a pull request while the `verify` check is red.
