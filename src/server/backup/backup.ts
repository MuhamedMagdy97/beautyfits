import { spawn } from "node:child_process";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { mkdir, open, readdir, rename, rm, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { PassThrough, type Readable, type Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

/**
 * Database and media backups (TASK-064, ADR-0072).
 *
 * A backup is a `pg_dump` custom-format archive plus a tar of MEDIA_DIR, each
 * encrypted with AES-256-GCM (BACKUP_ENCRYPTION_KEY) and written to
 * BACKUP_DIR. Provider neutral: the PostgreSQL client tools run either from
 * PATH or behind BACKUP_PG_COMMAND_PREFIX (for example `docker exec`).
 * Nothing here prints the key or database passwords.
 */

export type BackupTier = "daily" | "weekly";

export type BackupConfig = {
  databaseUrl: string;
  key: Buffer;
  dir: string;
  mediaDir: string;
  dailyKeep: number;
  weeklyKeep: number;
};

const MAGIC = Buffer.from("BFBK1");
const IV_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = MAGIC.length + IV_BYTES;

export function parseEncryptionKey(value: string | undefined): Buffer {
  const key = Buffer.from(value?.trim() ?? "", "base64");
  if (key.length !== 32) {
    // Never echo the value.
    throw new Error(
      "BACKUP_ENCRYPTION_KEY must be 32 random bytes in base64 (see docs/operations/backup-and-recovery.md).",
    );
  }
  return key;
}

function positiveInt(value: string | undefined, fallback: number, name: string): number {
  if (!value) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new Error(`${name} must be a positive integer.`);
  return n;
}

export function readBackupConfig(
  env: Record<string, string | undefined> = process.env,
): BackupConfig {
  if (!env.DATABASE_URL) throw new Error("DATABASE_URL is not set.");
  return {
    databaseUrl: env.DATABASE_URL,
    key: parseEncryptionKey(env.BACKUP_ENCRYPTION_KEY),
    dir: env.BACKUP_DIR || ".backups",
    mediaDir: env.MEDIA_DIR || ".media",
    // ponytail: placeholder counts until the owner sets the retention policy (Q182).
    dailyKeep: positiveInt(env.BACKUP_DAILY_KEEP, 7, "BACKUP_DAILY_KEEP"),
    weeklyKeep: positiveInt(env.BACKUP_WEEKLY_KEEP, 4, "BACKUP_WEEKLY_KEEP"),
  };
}

// --- Encryption: MAGIC | IV | ciphertext | GCM tag ---------------------------

export async function encryptToFile(
  source: Readable | AsyncIterable<Buffer>,
  dest: string,
  key: Buffer,
): Promise<void> {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  await pipeline(
    source,
    async function* (chunks: AsyncIterable<Buffer>) {
      yield Buffer.concat([MAGIC, iv]);
      for await (const chunk of chunks) yield cipher.update(chunk);
      yield cipher.final();
      yield cipher.getAuthTag();
    },
    createWriteStream(dest),
  );
}

/** Decrypts to `dest`; throws (and removes `dest`) if the file was altered or the key is wrong. */
export async function decryptToFile(source: string, dest: string, key: Buffer): Promise<void> {
  const { size } = await stat(source);
  if (size < HEADER_BYTES + TAG_BYTES) throw new Error(`${source} is not a BeautyFits backup.`);
  const header = Buffer.alloc(HEADER_BYTES);
  const tag = Buffer.alloc(TAG_BYTES);
  const handle = await open(source, "r");
  try {
    await handle.read(header, 0, HEADER_BYTES, 0);
    await handle.read(tag, 0, TAG_BYTES, size - TAG_BYTES);
  } finally {
    await handle.close();
  }
  if (!header.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error(`${source} is not a BeautyFits backup.`);
  }
  const decipher = createDecipheriv("aes-256-gcm", key, header.subarray(MAGIC.length));
  decipher.setAuthTag(tag);
  const body =
    size - TAG_BYTES > HEADER_BYTES
      ? createReadStream(source, { start: HEADER_BYTES, end: size - TAG_BYTES - 1 })
      : (async function* () {})();
  try {
    await pipeline(body, decipher, createWriteStream(dest));
  } catch {
    await rm(dest, { force: true });
    throw new Error(`${source} could not be decrypted: wrong key or the file was altered.`);
  }
}

// --- Naming and retention -------------------------------------------------------

const NAME = /^beautyfits-(\d{8}T\d{6}Z)-(daily|weekly)\.(db|media)\.enc$/;

export function backupStamp(now: Date): string {
  return now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
}

function stampTime(stamp: string): number {
  const [, y, mo, d, h, mi, s] = /^(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)Z$/.exec(stamp)!;
  return Date.UTC(+y, +mo - 1, +d, +h, +mi, +s);
}

type Parsed = { name: string; stamp: string; tier: BackupTier };

function parseNames(names: string[]): Parsed[] {
  return names.flatMap((name) => {
    const m = NAME.exec(name);
    return m ? [{ name, stamp: m[1], tier: m[2] as BackupTier }] : [];
  });
}

/** Weekly when no weekly backup was taken in the last 7 days, otherwise daily. */
export function chooseTier(existing: string[], now: Date): BackupTier {
  const weekAgo = now.getTime() - 7 * 24 * 60 * 60 * 1000;
  const recentWeekly = parseNames(existing).some(
    (b) => b.tier === "weekly" && stampTime(b.stamp) > weekAgo,
  );
  return recentWeekly ? "daily" : "weekly";
}

/** Files to delete: everything but the newest `keep` backups of each tier. */
export function expiredBackups(existing: string[], keep: Record<BackupTier, number>): string[] {
  const parsed = parseNames(existing);
  return (["daily", "weekly"] as const).flatMap((tier) => {
    const stamps = [...new Set(parsed.filter((b) => b.tier === tier).map((b) => b.stamp))]
      .sort()
      .reverse();
    const expired = new Set(stamps.slice(keep[tier]));
    return parsed.filter((b) => b.tier === tier && expired.has(b.stamp)).map((b) => b.name);
  });
}

// --- External tools -----------------------------------------------------------

/** `pg_dump`/`pg_restore` from PATH, or behind BACKUP_PG_COMMAND_PREFIX (split on spaces). */
function pgCommand(tool: string, args: string[]): [string, string[]] {
  const prefix = (process.env.BACKUP_PG_COMMAND_PREFIX ?? "").trim().split(/\s+/).filter(Boolean);
  return prefix.length > 0 ? [prefix[0], [...prefix.slice(1), tool, ...args]] : [tool, args];
}

/** Connection arguments; the password goes in PGPASSWORD, never on the command line. */
export function pgConnection(url: string): { args: string[]; env: NodeJS.ProcessEnv } {
  const u = new URL(url);
  const env: NodeJS.ProcessEnv = { ...process.env, PGPASSWORD: decodeURIComponent(u.password) };
  const sslmode = u.searchParams.get("sslmode");
  if (sslmode) env.PGSSLMODE = sslmode;
  return {
    args: [
      "-h",
      u.hostname,
      "-p",
      u.port || "5432",
      "-U",
      decodeURIComponent(u.username),
      "-d",
      databaseName(url),
    ],
    env,
  };
}

export function databaseName(url: string): string {
  return decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
}

async function run(
  command: [string, string[]],
  options: { env?: NodeJS.ProcessEnv; cwd?: string; stdin?: Readable; stdout?: Writable },
): Promise<void> {
  const [cmd, args] = command;
  const child = spawn(cmd, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    stdio: [options.stdin ? "pipe" : "ignore", options.stdout ? "pipe" : "ignore", "pipe"],
  });
  let stderr = "";
  child.stderr!.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
  const exited = new Promise<number | null>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });
  const flows: Promise<unknown>[] = [];
  if (options.stdin) flows.push(pipeline(options.stdin, child.stdin!));
  if (options.stdout) flows.push(pipeline(child.stdout!, options.stdout));
  const [code] = await Promise.all([exited, ...flows]);
  if (code !== 0) {
    throw new Error(`${cmd} failed (exit ${code}): ${stderr.trim()}`);
  }
}

// --- Backup --------------------------------------------------------------------

export type BackupResult = { tier: BackupTier; dbFile: string; mediaFile: string | null };

async function writeEncrypted(
  dest: string,
  key: Buffer,
  produce: (out: Writable) => Promise<void>,
): Promise<void> {
  const partial = `${dest}.partial`;
  try {
    // Plaintext flows tool → cipher → disk; it is never written unencrypted.
    const plain = new PassThrough();
    await Promise.all([
      produce(plain).catch((error: unknown) => {
        plain.destroy(error as Error);
        throw error;
      }),
      encryptToFile(plain, partial, key),
    ]);
    await rename(partial, dest);
  } catch (error) {
    await rm(partial, { force: true });
    throw error;
  }
}

/**
 * Takes one backup into `config.dir`. `snapshot` (from `pg_export_snapshot()`)
 * makes the dump match an open transaction exactly (used by the restore drill).
 */
export async function createBackup(
  config: BackupConfig,
  options: { now?: Date; snapshot?: string } = {},
): Promise<BackupResult> {
  const now = options.now ?? new Date();
  await mkdir(config.dir, { recursive: true });
  const tier = chooseTier(await readdir(config.dir), now);
  const base = join(config.dir, `beautyfits-${backupStamp(now)}-${tier}`);

  const dbFile = `${base}.db.enc`;
  const { args, env } = pgConnection(config.databaseUrl);
  const dumpArgs = ["--format=custom", ...args];
  if (options.snapshot) dumpArgs.push(`--snapshot=${options.snapshot}`);
  await writeEncrypted(dbFile, config.key, (out) =>
    run(pgCommand("pg_dump", dumpArgs), { env, stdout: out }),
  );

  let mediaFile: string | null = null;
  if (existsSync(config.mediaDir)) {
    mediaFile = `${base}.media.enc`;
    await writeEncrypted(mediaFile, config.key, (out) =>
      run(["tar", ["-cf", "-", "."]], { cwd: config.mediaDir, stdout: out }),
    );
  }
  return { tier, dbFile, mediaFile };
}

/** Deletes backups past the retention counts; returns the deleted file names. */
export async function pruneBackups(config: BackupConfig): Promise<string[]> {
  const expired = expiredBackups(await readdir(config.dir), {
    daily: config.dailyKeep,
    weekly: config.weeklyKeep,
  });
  for (const name of expired) await unlink(join(config.dir, name));
  return expired;
}

// --- Restore -------------------------------------------------------------------

export function clientFor(url: string): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
}

/**
 * Restores a database backup into `targetUrl`. The target database must
 * already exist and be empty, so a restore can never overwrite live data.
 */
export async function restoreDatabase(
  file: string,
  targetUrl: string,
  key: Buffer,
  workDir: string,
): Promise<void> {
  const target = clientFor(targetUrl);
  try {
    const [{ n }] = await target.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM pg_tables WHERE schemaname NOT IN ('pg_catalog', 'information_schema')`,
    );
    if (n > 0) {
      throw new Error(
        `Refusing to restore: database "${databaseName(targetUrl)}" is not empty (${n} tables). Restore into a new, empty database.`,
      );
    }
  } finally {
    await target.$disconnect();
  }

  const plain = join(workDir, "restore.dump");
  await decryptToFile(file, plain, key);
  try {
    const { args, env } = pgConnection(targetUrl);
    await run(
      pgCommand("pg_restore", ["--no-owner", "--no-privileges", "--exit-on-error", ...args]),
      {
        env,
        stdin: createReadStream(plain),
      },
    );
  } finally {
    await rm(plain, { force: true });
  }
}

/** Extracts a media backup into `mediaDir`, which must not exist or be empty. */
export async function restoreMedia(
  file: string,
  mediaDir: string,
  key: Buffer,
  workDir: string,
): Promise<void> {
  if (existsSync(mediaDir) && (await readdir(mediaDir)).length > 0) {
    throw new Error(`Refusing to restore media: ${mediaDir} is not empty.`);
  }
  await mkdir(mediaDir, { recursive: true });
  const plain = join(workDir, "restore.media.tar");
  await decryptToFile(file, plain, key);
  try {
    await run(["tar", ["-xf", "-"]], { cwd: mediaDir, stdin: createReadStream(plain) });
  } finally {
    await rm(plain, { force: true });
  }
}
