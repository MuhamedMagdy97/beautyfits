import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { clientFor, databaseName } from "./backup";
import { runRestoreDrill, scratchDatabaseUrl } from "./restore-drill";

// Needs the PostgreSQL client tools: BACKUP_PG_COMMAND_PREFIX (CI runs them in
// a postgres:17 container) or pg_dump on PATH.
const toolsAvailable =
  !!process.env.BACKUP_PG_COMMAND_PREFIX?.trim() ||
  spawnSync("pg_dump", ["--version"]).status === 0;

describe.skipIf(!toolsAvailable)("restore drill (integration)", () => {
  const dirs: string[] = [];
  afterAll(() => Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true }))));

  it("backs up, restores into a scratch database and finds an exact copy", async () => {
    const mediaDir = await mkdtemp(join(tmpdir(), "bf-drill-media-"));
    dirs.push(mediaDir);
    await mkdir(join(mediaDir, "products", "p1"), { recursive: true });
    await writeFile(join(mediaDir, "products", "p1", "a.webp"), randomBytes(5_000));
    await writeFile(join(mediaDir, "top.txt"), "hello");

    const databaseUrl = process.env.DATABASE_URL!;
    const report = await runRestoreDrill({
      databaseUrl,
      key: randomBytes(32),
      dir: "unused",
      mediaDir,
      dailyKeep: 7,
      weeklyKeep: 4,
    });

    expect(report.problems).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.migrations).toBeGreaterThan(0);
    expect(report.tables).toBeGreaterThan(50);
    expect(report.mediaFiles).toBe(2);

    // The scratch database is dropped afterwards.
    const admin = clientFor(databaseUrl);
    try {
      const rows = await admin.$queryRawUnsafe<unknown[]>(
        `SELECT 1 FROM pg_database WHERE datname = '${databaseName(scratchDatabaseUrl(databaseUrl))}'`,
      );
      expect(rows).toHaveLength(0);
    } finally {
      await admin.$disconnect();
    }
  }, 180_000);
});
