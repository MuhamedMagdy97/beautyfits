// Restore (TASK-064, ADR-0072), see docs/operations/backup-and-recovery.md:
//   npm run db:restore -- <backup.db.enc> [<backup.media.enc> <media-dir>]
// Restores into RESTORE_DATABASE_URL, which must be an existing, empty
// database; the media directory must not exist or be empty. Nothing live is
// ever overwritten.
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseEncryptionKey, restoreDatabase, restoreMedia } from "@/server/backup/backup";

if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

async function main(): Promise<void> {
  const [dbFile, mediaFile, mediaDir] = process.argv.slice(2);
  if (!dbFile || (mediaFile && !mediaDir)) {
    throw new Error(
      "Usage: npm run db:restore -- <backup.db.enc> [<backup.media.enc> <media-dir>]",
    );
  }
  const targetUrl = process.env.RESTORE_DATABASE_URL;
  if (!targetUrl) throw new Error("RESTORE_DATABASE_URL is not set.");
  const key = parseEncryptionKey(process.env.BACKUP_ENCRYPTION_KEY);
  const workDir = await mkdtemp(join(tmpdir(), "beautyfits-restore-"));
  try {
    await restoreDatabase(dbFile, targetUrl, key, workDir);
    console.log("Database restored");
    if (mediaFile) {
      await restoreMedia(mediaFile, mediaDir, key, workDir);
      console.log(`Media restored to ${mediaDir}`);
    }
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

// The package is CommonJS for tsx, so no top-level await.
main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
