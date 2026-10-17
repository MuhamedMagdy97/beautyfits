import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import {
  type BackupConfig,
  clientFor,
  createBackup,
  databaseName,
  restoreDatabase,
  restoreMedia,
} from "./backup";

/**
 * Restore drill (TASK-064, ADR-0072): back up, restore into a scratch
 * database (and a scratch media directory), and prove the copy matches.
 */

type Queryable = { $queryRawUnsafe<T = unknown>(query: string): Promise<T> };

export type DatabaseStats = {
  migrations: string[];
  rowCounts: Record<string, number>;
  /** Rows breaking an invariant; all must be 0. */
  invariantViolations: Record<string, number>;
};

const INVARIANTS: Record<string, string> = {
  // Wallet balance = sum of its ledger (AGENTS.md: every wallet change is a ledger row).
  walletBalanceEqualsLedger: `
    SELECT count(*)::int AS n FROM wallets w
    LEFT JOIN (
      SELECT wallet_id, sum(CASE WHEN direction = 'CREDIT' THEN amount ELSE -amount END) AS s
      FROM wallet_transactions GROUP BY wallet_id
    ) t ON t.wallet_id = w.id
    WHERE w.balance <> COALESCE(t.s, 0)`,
  // Stock = sum of its movements (AGENTS.md: every inventory change is a movement).
  inventoryEqualsMovements: `
    SELECT count(*)::int AS n FROM inventory_balances b
    FULL JOIN (
      SELECT product_variant_id, sum(available_delta) AS a, sum(reserved_delta) AS r,
             sum(damaged_delta) AS d
      FROM inventory_movements GROUP BY product_variant_id
    ) m ON m.product_variant_id = b.product_variant_id
    WHERE COALESCE(b.available_quantity, 0) <> COALESCE(m.a, 0)
       OR COALESCE(b.reserved_quantity, 0) <> COALESCE(m.r, 0)
       OR COALESCE(b.damaged_quantity, 0) <> COALESCE(m.d, 0)`,
};

export async function collectStats(db: Queryable): Promise<DatabaseStats> {
  const migrations = await db.$queryRawUnsafe<{ migration_name: string }[]>(
    `SELECT migration_name FROM _prisma_migrations
     WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name`,
  );
  const tables = await db.$queryRawUnsafe<{ table_name: string }[]>(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`,
  );
  const rowCounts: Record<string, number> = {};
  for (const { table_name } of tables) {
    const [{ n }] = await db.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM public."${table_name.replace(/"/g, '""')}"`,
    );
    rowCounts[table_name] = n;
  }
  const invariantViolations: Record<string, number> = {};
  for (const [name, sql] of Object.entries(INVARIANTS)) {
    const [{ n }] = await db.$queryRawUnsafe<{ n: number }[]>(sql);
    invariantViolations[name] = n;
  }
  return { migrations: migrations.map((m) => m.migration_name), rowCounts, invariantViolations };
}

/** Problems found comparing the source with the restored copy; empty = pass. */
export function compareStats(source: DatabaseStats, restored: DatabaseStats): string[] {
  const problems: string[] = [];
  if (source.migrations.join() !== restored.migrations.join()) {
    problems.push(
      `Migrations differ: source has ${source.migrations.length}, restored has ${restored.migrations.length}.`,
    );
  }
  const tables = new Set([...Object.keys(source.rowCounts), ...Object.keys(restored.rowCounts)]);
  for (const table of [...tables].sort()) {
    if (source.rowCounts[table] !== restored.rowCounts[table]) {
      problems.push(
        `Row count of ${table}: source ${source.rowCounts[table] ?? "missing"}, restored ${restored.rowCounts[table] ?? "missing"}.`,
      );
    }
  }
  for (const [name, n] of Object.entries(restored.invariantViolations)) {
    if (n !== 0) problems.push(`Invariant ${name} broken in ${n} rows of the restored copy.`);
  }
  return problems;
}

const SCRATCH_NAME = /^[a-z0-9_]+_(drill|test)$/;

/** `<source>_drill`; never the source itself and never the dev database. */
export function scratchDatabaseUrl(sourceUrl: string): string {
  const source = databaseName(sourceUrl);
  const scratch = source.endsWith("_drill") ? source : `${source}_drill`;
  if (!SCRATCH_NAME.test(scratch) || scratch === source || scratch === "beautyfits") {
    throw new Error(
      `Refusing to use "${scratch}" as the drill database (must end in _drill/_test and differ from the source).`,
    );
  }
  const url = new URL(sourceUrl);
  url.pathname = `/${scratch}`;
  return url.toString();
}

async function hashTree(dir: string): Promise<Record<string, string>> {
  if (!existsSync(dir)) return {};
  const files: Record<string, string> = {};
  for (const entry of await readdir(dir, { recursive: true })) {
    const path = join(dir, entry);
    if (!(await stat(path)).isFile()) continue;
    const key = relative(dir, path).split(sep).join("/");
    files[key] = createHash("sha256")
      .update(await readFile(path))
      .digest("hex");
  }
  return files;
}

export function compareMedia(
  source: Record<string, string>,
  restored: Record<string, string>,
): string[] {
  const names = new Set([...Object.keys(source), ...Object.keys(restored)]);
  return [...names]
    .filter((n) => source[n] !== restored[n])
    .sort()
    .map((n) => `Media file ${n} differs or is missing.`);
}

export type DrillReport = {
  ok: boolean;
  problems: string[];
  tier: string;
  backupBytes: number;
  migrations: number;
  tables: number;
  rows: number;
  mediaFiles: number;
  backupMs: number;
  restoreMs: number;
};

/**
 * Runs the drill in a temporary directory. The dump uses the snapshot of the
 * transaction that reads the source statistics, so a busy source still compares
 * exactly. The scratch database is dropped at the end unless `keep` is set.
 */
export async function runRestoreDrill(
  config: BackupConfig,
  options: { keep?: boolean } = {},
): Promise<DrillReport> {
  const scratchUrl = scratchDatabaseUrl(config.databaseUrl);
  const scratchName = databaseName(scratchUrl);
  const workDir = await mkdtemp(join(tmpdir(), "beautyfits-drill-"));
  const adminUrl = new URL(config.databaseUrl);
  adminUrl.pathname = "/postgres";
  adminUrl.search = "";
  const admin = clientFor(adminUrl.toString());
  const source = clientFor(config.databaseUrl);
  try {
    const started = Date.now();
    const { backup, sourceStats } = await source.$transaction(
      async (tx) => {
        const [{ snapshot }] = await tx.$queryRawUnsafe<{ snapshot: string }[]>(
          "SELECT pg_export_snapshot() AS snapshot",
        );
        const backup = await createBackup(
          { ...config, dir: join(workDir, "backups") },
          { snapshot },
        );
        return { backup, sourceStats: await collectStats(tx) };
      },
      { isolationLevel: "RepeatableRead", timeout: 60 * 60 * 1000, maxWait: 10_000 },
    );
    const backupMs = Date.now() - started;

    // scratchName is validated by scratchDatabaseUrl, so it is safe as an identifier.
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${scratchName}" WITH (FORCE)`);
    await admin.$executeRawUnsafe(`CREATE DATABASE "${scratchName}"`);
    const restoreStarted = Date.now();
    await restoreDatabase(backup.dbFile, scratchUrl, config.key, workDir);
    const restoreMs = Date.now() - restoreStarted;

    const restored = clientFor(scratchUrl);
    let restoredStats: Awaited<ReturnType<typeof collectStats>>;
    try {
      restoredStats = await collectStats(restored);
    } finally {
      await restored.$disconnect();
    }
    const problems = compareStats(sourceStats, restoredStats);

    let mediaFiles = 0;
    if (backup.mediaFile) {
      const mediaOut = join(workDir, "media");
      await restoreMedia(backup.mediaFile, mediaOut, config.key, workDir);
      const sourceMedia = await hashTree(config.mediaDir);
      mediaFiles = Object.keys(sourceMedia).length;
      problems.push(...compareMedia(sourceMedia, await hashTree(mediaOut)));
    }

    const counts = Object.values(sourceStats.rowCounts);
    return {
      ok: problems.length === 0,
      problems,
      tier: backup.tier,
      backupBytes:
        (await stat(backup.dbFile)).size +
        (backup.mediaFile ? (await stat(backup.mediaFile)).size : 0),
      migrations: sourceStats.migrations.length,
      tables: counts.length,
      rows: counts.reduce((a, b) => a + b, 0),
      mediaFiles,
      backupMs,
      restoreMs,
    };
  } finally {
    await source.$disconnect();
    if (!options.keep) {
      await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${scratchName}" WITH (FORCE)`);
    }
    await admin.$disconnect();
    await rm(workDir, { recursive: true, force: true });
  }
}
