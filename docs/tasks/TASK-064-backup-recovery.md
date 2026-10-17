# TASK-064 — Backup & Disaster Recovery Validation

## Goal

Automated, encrypted database and media backups with retention, a documented recovery procedure, and a restore drill that proves a backup can actually be restored.

## Dependencies

TASK-003 (migrations), TASK-016 / ADR-0021 (local media storage), TASK-006 (CI). Scheduling and off-site storage: TASK-066 (production deployment, hosting provider).

## Source of Truth

- Business Spec Q182 (daily + weekly backups with longer retention, encrypted, off-environment, retention policy required), Q183 (documented recovery plan and tested restores)
- Architecture §24 (Reliability & Recovery), §27 (hosting provider deferred)
- Security Requirements §11
- Test Strategy §3 ("Backup restore drill")

## Scope

- `npm run db:backup` (`scripts/backup-db.ts`): encrypted `pg_dump` (custom format) and `MEDIA_DIR` tar into `BACKUP_DIR`, daily/weekly tier, retention pruning.
- `npm run db:restore` (`scripts/restore-db.ts`): restore a database (and optionally media) backup into an existing, empty database / empty directory.
- `npm run db:restore-drill` (`scripts/restore-drill.ts`): back up, restore into `<db>_drill`, verify migrations, row counts of every table, wallet and inventory ledger invariants and media checksums.
- Runbook `docs/operations/backup-and-recovery.md`, ADR-0072, env vars in `.env.example`, CI runs the drill test.

## Non-Goals

- Scheduling, alerting on failed backups, off-site copying (TASK-066).
- Point-in-time recovery / WAL archiving (hosting decision).
- Object-storage media backups (when a storage provider replaces `MEDIA_DIR`).

## Files / Modules

- `src/server/backup/backup.ts` — config, encryption, naming/retention, backup, restore
- `src/server/backup/restore-drill.ts` — statistics, comparison, drill
- `src/server/backup/backup.test.ts`, `src/server/backup/restore-drill.int.test.ts`
- `scripts/backup-db.ts`, `scripts/restore-db.ts`, `scripts/restore-drill.ts`; `package.json` scripts
- `.env.example`, `.gitignore` (`/.backups/`), `.github/workflows/ci.yml` (`BACKUP_PG_COMMAND_PREFIX`)
- `docs/operations/backup-and-recovery.md`, `docs/decisions/ADR-0072-backup-and-restore-drill.md`

## Business Rules

- Q182: daily backups, weekly backups kept longer, encrypted. The weekly/daily split is technical (weekly when no weekly backup from the last 7 days exists); retention counts are placeholders (see Open Items).
- Q183: the restore is tested by the drill, locally and in CI.

## API Changes

None.

## Database Changes

None (no migration).

## Security / Authorization

- AES-256-GCM, key from `BACKUP_ENCRYPTION_KEY`; tampering or a wrong key is detected before restoring. The key and database passwords are never printed or passed on the command line (`PGPASSWORD`).
- Restore refuses a non-empty target database or media directory; the drill only uses `<db>_drill` (must end in `_drill`/`_test`, never the source or `beautyfits`).
- Backups are operator CLI tools, not HTTP endpoints.

## Acceptance Criteria

- [x] `db:backup` writes encrypted database and media backups, daily/weekly, and prunes past retention.
- [x] `db:restore` restores into an empty database and refuses a non-empty one.
- [x] `db:restore-drill` restores into a scratch database and verifies migrations, row counts, wallet/inventory invariants and media; exits 1 on any difference.
- [x] Runbook with step-by-step recovery, schedule, key management and open decisions.
- [x] Automated tests (unit + integration drill in CI).

## Tests

- Unit (`backup.test.ts`): encryption round trip, no plaintext stored, wrong key / altered / foreign file rejected, key validation without echo, password not in argv, UTC stamp, tier choice, retention selection, stats/media comparison, scratch database naming guard.
- Integration (`restore-drill.int.test.ts`): full drill against the test database with a temporary media directory; scratch database dropped afterwards. Skipped only when no PostgreSQL client tools are configured (CI configures them).

## Edge Cases

- Live writes during the drill: the dump uses the snapshot of the transaction that reads the source statistics.
- Missing `MEDIA_DIR`: media backup skipped with a message.
- Interrupted backup: written as `.partial`, renamed only on success, removed on failure.
- `pg_dump` older than the server: use `BACKUP_PG_COMMAND_PREFIX` with a matching container.

## Definition of Done

Required checks green, drill run successfully against the local database, docs updated.

## Open Items

- `[BUSINESS DECISION REQUIRED]` Retention periods for daily and weekly backups (Q182 requires a policy). Defaults 7 daily / 4 weekly are technical placeholders.
- `[BUSINESS DECISION REQUIRED]` RPO and RTO. Daily backups give an RPO of up to 24 hours; anything shorter needs PITR at hosting time.
- `[BUSINESS DECISION REQUIRED]` Off-environment storage target and who may access it — depends on the hosting provider (Architecture §27). Until then backups are local and do not meet Q182's off-environment rule.
- Drill cadence (proposed: monthly and after major releases) — to confirm with the owner.
- TASK-066: schedule `db:backup` daily, alert on failure, copy `BACKUP_DIR` off-environment, store the key in the secret store.

## Status
- [x] Planned
- [x] In Progress
- [x] Tests Passing
- [ ] Reviewed
- [ ] Done
