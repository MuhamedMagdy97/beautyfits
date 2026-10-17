// Backup job (TASK-064, ADR-0072): `npm run db:backup`.
// Writes an encrypted database dump and media archive to BACKUP_DIR (weekly
// when no weekly backup exists from the last 7 days, otherwise daily), then
// prunes past BACKUP_DAILY_KEEP / BACKUP_WEEKLY_KEEP. Run daily; scheduling
// and off-site copying come with deployment (TASK-066).
import { existsSync } from "node:fs";
import { createBackup, pruneBackups, readBackupConfig } from "@/server/backup/backup";

if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

async function main(): Promise<void> {
  const config = readBackupConfig();
  const backup = await createBackup(config);
  console.log(`Backup (${backup.tier}): ${backup.dbFile}`);
  console.log(
    backup.mediaFile
      ? `Media: ${backup.mediaFile}`
      : `Media: ${config.mediaDir} does not exist, skipped`,
  );
  const pruned = await pruneBackups(config);
  console.log(`Pruned ${pruned.length} expired backup files`);
}

// The package is CommonJS for tsx, so no top-level await.
main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
