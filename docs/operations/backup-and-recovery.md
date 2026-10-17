# Backup & Recovery Runbook

Owner: operations. Introduced by TASK-064 (ADR-0072). Requirements: Business Spec Q182 (automated daily + weekly backups with longer retention, encrypted, off-environment) and Q183 (documented recovery plan and tested restores); Architecture §24; Security §11.

## 1. What is backed up

| Data | How | File |
| --- | --- | --- |
| PostgreSQL database (all business data, audit logs, ledgers, migrations table) | `pg_dump --format=custom` | `beautyfits-<UTC stamp>-<daily\|weekly>.db.enc` |
| Uploaded media (`MEDIA_DIR`, product images, ADR-0021) | `tar` of the directory | `beautyfits-<UTC stamp>-<daily\|weekly>.media.enc` |

Both files are encrypted with AES-256-GCM (`BACKUP_ENCRYPTION_KEY`); a tampered file or wrong key is rejected before anything is restored. Plaintext is never written to `BACKUP_DIR`.

Not backed up: `.mail/` and `.whatsapp/` (local development outboxes, ADR-0014/ADR-0043), `.env` (secrets live in the secret store, §6), rebuildable artifacts (`.next/`, `node_modules/`, generated Prisma client).

When an object-storage provider replaces `MEDIA_DIR`, media backups move to that provider's versioning/replication and the media part of this tooling is retired.

## 2. Configuration

See `.env.example` (section "Backups"): `BACKUP_ENCRYPTION_KEY`, `BACKUP_DIR`, `BACKUP_DAILY_KEEP`, `BACKUP_WEEKLY_KEEP`, `BACKUP_PG_COMMAND_PREFIX`, `RESTORE_DATABASE_URL`.

- `pg_dump`/`pg_restore` must be the server's major version or newer. Either install them on the host or run them in a container through `BACKUP_PG_COMMAND_PREFIX`, which must pass `PGPASSWORD` through, for example:
  - docker-compose database: `docker exec -i -e PGPASSWORD beautyfits-postgres-1`
  - any reachable server: `docker run --rm -i --network host -e PGPASSWORD postgres:17-alpine`
- Passwords are passed in `PGPASSWORD`, never on the command line. The tools never print the key.

## 3. Schedule and retention

- `npm run db:backup` once a day. The run is **weekly** when no weekly backup from the last 7 days exists in `BACKUP_DIR`, otherwise **daily**; then it deletes all but the newest `BACKUP_DAILY_KEEP` daily (default 7) and `BACKUP_WEEKLY_KEEP` weekly (default 4) backups.
- Scheduling (cron/worker), alerting on a failed run and copying `BACKUP_DIR` off-environment are part of deployment: **TASK-066**.
- `npm run db:restore-drill` at least monthly and after every major release or schema change (owner decision 2026-10-18, BD-072).
- Resolved (owner decision 2026-10-18): keep current behaviour — 7 daily / 4 weekly backups are kept (Q182, BD-070).

## 4. Off-environment storage

Deferred (owner 2026-10-18): localhost only for now — the off-site target depends on the hosting provider (Architecture §27). Requirements for the target: a different account/region than the database, write-once or versioned storage, access limited to the backup job and the Owner. Until then `BACKUP_DIR` is local and **does not satisfy Q182's off-environment rule**.

## 5. Restore drill (proves restores work)

```sh
npm run db:restore-drill            # -- --keep to leave the scratch database
```

The drill, in a temporary directory:

1. opens a repeatable-read transaction on `DATABASE_URL` and takes a backup with `pg_dump --snapshot` of that same transaction (so a busy database still compares exactly);
2. creates the scratch database `<name>_drill` (refuses any name not ending in `_drill`/`_test`, the source itself, or `beautyfits`) and restores into it;
3. compares the applied migrations and the row count of every table, and checks on the restored copy that every wallet balance equals the sum of its ledger and every inventory balance equals the sum of its movements;
4. restores the media archive into a temporary directory and compares SHA-256 checksums of every file;
5. prints PASSED/FAILED with backup and restore timings (evidence for the RTO), drops the scratch database and deletes the temporary files.

Record each drill (date, result, timings, operator) in the operations log. The integration test `src/server/backup/restore-drill.int.test.ts` runs the same drill in CI.

## 6. Recovery procedure

Use when the database or media is lost or corrupted, or to recover to an earlier point.

1. **Declare the incident** and stop writes: put the site in maintenance / stop the app and background jobs, so nothing writes to a database that will be replaced.
2. **Pick the backup**: the newest `*.db.enc` from before the incident (and the `*.media.enc` with the same stamp). Copy them from off-site storage to the recovery host.
3. **Get the key** `BACKUP_ENCRYPTION_KEY` from the secret store (kept separately from the backups).
4. **Create a new, empty database** (never restore over the damaged one; keep it for investigation):
   `CREATE DATABASE beautyfits_restored_<date>;`
5. **Restore**:
   ```sh
   RESTORE_DATABASE_URL="postgresql://...:5432/beautyfits_restored_<date>?schema=public" \
     npm run db:restore -- <file>.db.enc <file>.media.enc <new-media-dir>
   ```
   The command refuses a database that has any table, or a media directory that is not empty.
6. **Verify**:
   - `DATABASE_URL=<restored url> npm run db:status` — all migrations applied; if the release being run is newer, `npm run db:deploy`.
   - Spot-check: latest orders, wallet balances, stock of a few products, an employee login.
   - Optionally `DATABASE_URL=<restored url> npm run db:restore-drill` to check the ledger invariants.
7. **Switch over**: point `DATABASE_URL` / `MEDIA_DIR` at the restored database and directory, start the app and jobs, check `/api/v1/health` and a test order flow.
8. **After**: data written between the backup and the incident is lost (up to one backup interval); reconcile from external records (shipping provider, customer messages). Write an incident note with the timeline and measured recovery time.

## 7. Recovery objectives

Resolved (owner decision 2026-10-18): keep current behaviour — daily backups, so the RPO (maximum acceptable data loss) is up to 24 hours; no RTO target is set (BD-071). A shorter RPO needs continuous WAL archiving / point-in-time recovery, which depends on the hosting provider (TASK-066). The drill prints restore timings to size the RTO.

## 8. Key management

- Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.
- Keep it in the secret store and in a second, offline place controlled by the Owner. Losing it makes every backup unreadable.
- Rotation: set a new key; new backups use it. Keep old keys until every backup encrypted with them has expired.
