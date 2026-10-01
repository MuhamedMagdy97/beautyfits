# ADR-0017 — Bootstrap, default roles and the settings table

- **Status:** Accepted (TASK-004); the defaults in §5 await product-owner confirmation
- **Date:** 2026-10-01
- **Relates to:** ADR-0003 (seed strategy), ADR-0015 (staff session settings), ADR-0016 (roles); Business Spec Q163, Q179–Q181, R15, R28, R29; permission catalog §3 (D-05); DB Design §4, §20 and "v1.2 TASK-004 Amendments"

A fresh database had no Owner, no roles and no settings, and nothing could create the first Owner: invitations need an inviter (ADR-0016) and no endpoint may create an admin (roadmap TASK-004). This ADR records how a new environment becomes usable without editing the database by hand.

## 1. Two commands, no endpoint

- **Production bootstrap:** `npm run db:seed` (`prisma db seed`, wired in `prisma.config.ts` to `tsx prisma/seed.ts`). Safe to run any number of times:
  1. checks that every permission of the catalog is in the `permissions` table (inserted by migrations; otherwise it stops and asks for the migrations);
  2. inserts missing settings with their default (§3) and never overwrites a stored value;
  3. creates each missing default role of permission catalog §3 (§2);
  4. creates the first Owner (§4) while no Owner exists.
- **Development sample data:** `npm run db:seed:dev` (`tsx prisma/seed-dev.ts`). Runs the bootstrap, then adds two sample staff accounts (an Inventory Manager and a Catalog Editor at `@beautyfits.example`, a reserved domain) with the password `DEV_SEED_PASSWORD`. It refuses to run with `NODE_ENV=production` and needs an Owner (the sample staff are recorded as created by the Owner).
- The logic lives in `src/server/modules/bootstrap/`; no route imports it (a unit test checks this). Invitations still cannot create an Owner (`level` excludes `OWNER`).
- Until `audit_logs` exists (TASK-013), the bootstrap writes one `bootstrap.completed` line to the structured logger (settings and roles added, Owner outcome and id; never the email or password).

## 2. Default roles

- The seven roles of catalog §3 are editable custom roles (`is_system_role = false`, ADR-0016 §4), `created_by_employee_id` null.
- Each has a **fixed id** (`00000000-0000-7000-8000-00000000000N`), so the seed is deterministic and a role the Owner renamed is not created again under its old name. A default role is skipped when its id exists or another role already uses its name (ignoring case). Existing roles are never changed, so the Owner's edits survive later runs.
- A unit test checks the list against catalog §3 and that no default role contains an Owner/Admin-only permission or one the catalog keeps out of every default role.

## 3. Settings table

- `settings` (DB Design §20): `key` (primary key), `value_json`, `data_type` (`INTEGER`, `BOOLEAN`, `STRING`, `JSON`), `updated_by_employee_id` (null for bootstrap values), `updated_at`. Migration `settings`.
- Known keys, types, defaults and validity checks are listed in `src/server/modules/settings/settings.ts`. Readers fall back to the default when a row is missing or invalid (an invalid row is logged), so an empty table behaves like the documented defaults.
- First keys: `staff_session.max_lifetime_minutes` = 720 and `staff_session.idle_timeout_minutes` = 60 (R29). The employee login service now reads them on every login and session check (ADR-0015 provider); a changed value applies as ADR-0015 describes.
- `setting_history`, the settings endpoints and the approval of critical settings (Q180, Q181) come with TASK-057, when values can first change through the product.

## 4. First Owner

- Details come from `BOOTSTRAP_OWNER_EMAIL`, `BOOTSTRAP_OWNER_PASSWORD` and optional `BOOTSTRAP_OWNER_NAME` (default "Owner"). Both email and password, or neither; with neither the bootstrap prints that no Owner exists yet. These variables are read only by the seed scripts, not by the web server, so the password is not part of the server configuration (`src/server/config/env.ts`). Real values never go in Git.
- The email is normalized and validated; the password must pass the password policy (Q156). Invalid details stop the bootstrap before anything is written.
- Created only while no `OWNER` employee exists, under an advisory lock, so two bootstraps at once create one Owner. An existing Owner is never changed: a lost password goes through the employee password reset (TASK-011).
- The account is `EMPLOYEE`, `ACTIVE`, email marked verified; the employee is `OWNER`, `created_by_employee_id` null (DB Design "v1.2 TASK-011 Amendments"). The first login still sends an email code before the device is trusted (R28).
- A customer account with the same email is allowed (R15); another employee account with that email stops the bootstrap.

## 5. Defaults where the documents are silent ([BUSINESS DECISION REQUIRED] for confirmation)

1. **The Owner's email is marked verified by the bootstrap.** The person running it chose the address, and the first login proves it with an email code (R28).
2. **Default roles are created once.** Later runs never restore a default role the Owner edited, renamed or emptied.
3. **Staff session settings accept any whole number of minutes above zero.** The documents set the defaults (R29) but no minimum or maximum; limits should be decided with the settings screen (TASK-057).

## Consequences

- New devDependency **`tsx` 4.23.15** (exact): runs the TypeScript seed scripts with the `@/` path alias, as Prisma's seed documentation recommends. Development and deployment tooling only; nothing in the app imports it. Production bootstrap therefore needs dev dependencies installed (as `prisma` itself already does).
- `src/test/integration/database.ts` empties `settings` between tests; readers fall back to the defaults.
- Ownership transfer is still out of scope (User Flows §2; no endpoint in the API contract).
