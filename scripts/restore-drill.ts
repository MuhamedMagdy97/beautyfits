// Restore drill (TASK-064, ADR-0072): `npm run db:restore-drill [-- --keep]`.
// Backs up DATABASE_URL and MEDIA_DIR, restores into the scratch database
// `<name>_drill` and a temporary directory, and verifies migrations, row
// counts of every table, wallet/inventory invariants and media checksums.
// Exit code 1 when anything differs. `--keep` leaves the scratch database.
import { existsSync } from "node:fs";
import { readBackupConfig } from "@/server/backup/backup";
import { runRestoreDrill } from "@/server/backup/restore-drill";

if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

async function main(): Promise<void> {
  const report = await runRestoreDrill(readBackupConfig(), {
    keep: process.argv.includes("--keep"),
  });
  console.log(
    [
      `Restore drill: ${report.ok ? "PASSED" : "FAILED"}`,
      `  backup tier ${report.tier}, ${report.backupBytes} encrypted bytes, ${report.backupMs} ms`,
      `  restore ${report.restoreMs} ms`,
      `  ${report.migrations} migrations, ${report.tables} tables, ${report.rows} rows, ${report.mediaFiles} media files compared`,
      ...report.problems.map((p) => `  PROBLEM: ${p}`),
    ].join("\n"),
  );
  if (!report.ok) process.exitCode = 1;
}

// The package is CommonJS for tsx, so no top-level await.
main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
