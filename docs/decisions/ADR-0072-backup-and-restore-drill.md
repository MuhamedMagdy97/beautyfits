# ADR-0072 — Backups, Encryption and the Restore Drill

- **Status:** Accepted (TASK-064)
- **Date:** 2026-10-18
- **Relates to:** ADR-0021 (local media storage), ADR-0012 (CI), ADR-0010 (integration tests); Business Spec Q182, Q183; Architecture §24, §27; Security §11; runbook `docs/operations/backup-and-recovery.md`

## Context

Q182/Q183 require automated daily and weekly backups, encrypted and off-environment, with a documented and tested restore. The hosting provider is not decided, so managed backups (provider snapshots, PITR) cannot be chosen yet.

## Decision

1. **Provider-neutral scripts**: `npm run db:backup`, `db:restore`, `db:restore-drill` (`scripts/*.ts`, logic in `src/server/backup/`). The database is dumped with `pg_dump --format=custom`; `MEDIA_DIR` is archived with `tar` (system tool; no new dependency).
2. **Client tools**: from PATH, or behind `BACKUP_PG_COMMAND_PREFIX` (e.g. `docker exec` / `docker run postgres:17-alpine`) so the tools match the server version. Passwords go through `PGPASSWORD`, never argv.
3. **Encryption**: AES-256-GCM with Node `crypto`, key `BACKUP_ENCRYPTION_KEY` (32 bytes, base64). File = `BFBK1` magic, 12-byte IV, ciphertext, 16-byte tag. Restore decrypts to a temporary file and only uses it after the tag verifies.
4. **Tiers and retention**: one daily run; it is `weekly` when no weekly backup from the last 7 days exists. Pruning keeps the newest `BACKUP_DAILY_KEEP` (7) daily and `BACKUP_WEEKLY_KEEP` (4) weekly backups — placeholders until the owner sets the policy.
5. **Safe restore**: the target must be an existing, empty database and the media directory empty, so a restore never overwrites data. The drill only uses a scratch database named `<source>_drill` (must end in `_drill`/`_test`, never the source or `beautyfits`).
6. **Drill verification**: the dump uses `--snapshot` of the repeatable-read transaction that reads the source statistics, so the comparison is exact on a live database: applied migrations, row counts of every table, wallet balance = ledger sum, inventory balance = movement sums, media SHA-256 checksums. CI runs it (`restore-drill.int.test.ts`); the test is skipped only where no client tools are configured.

## Consequences

- Scheduling, failure alerting and copying backups off-environment belong to TASK-066 with the hosting decision; until then backups are local and do not meet the off-environment rule.
- RPO is one day at best; PITR/WAL archiving is a hosting-time decision. RPO/RTO and retention periods are open business decisions.
- When media moves to object storage, its backup moves to the provider's versioning/replication.
