# TASK-004 — Seed & Bootstrap Data

## Goal
A fresh environment becomes usable without editing the database by hand: one command checks the permissions, adds the default settings and default roles, and creates the first Owner, who can then sign in and invite the rest of the staff.

## Dependencies
TASK-003 (migrations), TASK-011 (password hashing, staff login), TASK-012 (roles, permissions). Followed by TASK-013.

## Source of Truth
- Roadmap TASK-004 and its sequencing note
- Business Spec Q156, Q163, Q179–Q181, R15, R28, R29
- `docs/security/permission-catalog.md` §3 (default roles, D-05)
- Database Design §4, §20, "v1.2 TASK-011 Amendments" (first Owner has no creator), "v1.2 TASK-004 Amendments"
- ADR-0003 (seed strategy), ADR-0015 (staff session settings provider), ADR-0016 (roles); ADR-0017 (this task)

## Scope
- Owner bootstrap from `BOOTSTRAP_OWNER_EMAIL` / `BOOTSTRAP_OWNER_PASSWORD` (/ `BOOTSTRAP_OWNER_NAME`), only while no Owner exists.
- Default permissions: checked against the catalog (the rows come from the TASK-012 migration).
- Default roles: the seven roles of catalog §3, fixed ids, created once.
- Default settings: the `settings` table and the R29 staff session lengths; the employee login reads them.
- Development seed (`npm run db:seed:dev`, sample staff) separate from the production bootstrap (`npm run db:seed`).

## Non-Goals
- Settings endpoints, `setting_history`, approval of critical settings (TASK-057, TASK-013).
- Audit records (TASK-013): the bootstrap logs one structured line instead.
- Ownership transfer; sample catalog, customers or orders (their tables do not exist yet).

## Files / Modules
- `prisma/schema.prisma`, `prisma/migrations/20261001163002_settings/`, `prisma.config.ts` (`migrations.seed`), `prisma/seed.ts`, `prisma/seed-dev.ts`
- `src/server/modules/bootstrap/`: `bootstrap.ts`, `default-roles.ts`, `dev-seed.ts`, `cli.ts`
- `src/server/modules/settings/settings.ts`; `src/server/modules/auth/employee-auth-service.ts` (reads the settings); `src/server/modules/rbac/roles-service.ts` (exports the role-name lock)
- `package.json` (`db:seed`, `db:seed:dev`, devDependency `tsx`), `.env.example`, `README.md`

## Business Rules
- Catalog §3 default roles are editable templates (D-05); none holds an Owner/Admin-only permission (R18).
- Owner/Admin hold every permission (ADR-0016); the Owner needs no role.
- Staff session 12 h maximum, 60 min idle, Owner/Admin-configurable (R29, Q163).
- The Owner signs in like every employee: password, then an email code per device every 30 days (R28).
- Password policy (Q156); a customer may share the Owner's email (R15).

## API Changes
None. No endpoint creates an Owner.

## Database Changes
Migration `settings` (table `settings`, enum `setting_data_type`). Database Design "v1.2 TASK-004 Amendments".

## Security / Authorization
- Command line only; no route imports the bootstrap (unit test).
- Owner credentials come from environment variables read only by the seed scripts, never committed; the scripts print a reminder to remove the password from `.env`.
- An existing Owner is never changed; one Owner even when two bootstraps run at once (advisory lock).
- No email or password in logs.

## Acceptance Criteria
- No public "create admin" endpoint exists.
- Seed data is deterministic: same roles (fixed ids), settings and Owner on every run; re-running changes nothing.
- On an empty, migrated database, `npm run db:seed` with the Owner variables creates the Owner, seven default roles and two settings; the Owner can sign in with the password and the emailed code.
- Edits the Owner makes to default roles or settings survive later runs.
- All required checks pass.

## Tests
- Unit `src/server/modules/bootstrap/bootstrap.test.ts`: default roles match catalog §3 and exclude reserved and excluded permissions; fixed ids; R29 setting defaults and validity; Owner details parsing and the environment variables; no route uses the bootstrap; invitations cannot create an Owner.
- Integration `src/server/modules/bootstrap/bootstrap.int.test.ts`: fresh bootstrap, Owner creation, idempotency (Owner, renamed and edited roles, settings untouched), role name clash, concurrent bootstraps, shared customer email and employee email clash, invalid password writes nothing, settings reader (defaults, stored, invalid), development seed (production refused, needs Owner, sample staff permissions, idempotent).
- Manual: `npm run db:seed`, `npm run db:seed:dev`, Owner login through `/employee-auth/login` and `/verify-otp` with the code from `.mail/`, `GET /admin/roles` lists the seven roles.

## Edge Cases
- Only one of the two Owner variables set: stopped with a message.
- An Owner already exists and different details are given: nothing changes.
- The Owner renamed a default role: it is not created again.
- A settings row holds an invalid value: the default applies and a warning is logged.

## Definition of Done
Acceptance criteria met, docs updated, CI `verify` green, reviewed by the product owner.

## Open Items
Defaults where the documents are silent (ADR-0017 §5), confirmed by the product owner on 2026-10-01:
1. The bootstrap marks the Owner's email verified; the first login code proves it.
2. Default roles are created once; later runs never restore a role the Owner edited, renamed or emptied.
3. Staff session settings accept any whole number of minutes above zero; minimum and maximum to be decided with the settings screen (TASK-057).

Other:
- ADR-0016 §6 defaults (TASK-012) were confirmed on 2026-10-01.

## Status
- [x] Planned
- [x] In Progress
- [x] Tests Passing
- [ ] Reviewed
- [ ] Done
