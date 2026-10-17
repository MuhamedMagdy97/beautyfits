import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  backupStamp,
  chooseTier,
  decryptToFile,
  encryptToFile,
  expiredBackups,
  parseEncryptionKey,
  pgConnection,
  readBackupConfig,
} from "./backup";
import {
  compareMedia,
  compareStats,
  scratchDatabaseUrl,
  type DatabaseStats,
} from "./restore-drill";

describe("backup encryption", () => {
  let dir: string;
  const key = randomBytes(32);
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "bf-backup-test-"));
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it("round-trips and never stores plaintext", async () => {
    const plain = Buffer.concat([Buffer.from("SECRET-PAYLOAD "), randomBytes(200_000)]);
    await encryptToFile(Readable.from([plain]), join(dir, "b.enc"), key);
    const stored = await readFile(join(dir, "b.enc"));
    expect(stored.includes(Buffer.from("SECRET-PAYLOAD"))).toBe(false);
    await decryptToFile(join(dir, "b.enc"), join(dir, "b.out"), key);
    expect((await readFile(join(dir, "b.out"))).equals(plain)).toBe(true);
  });

  it("rejects a wrong key and an altered file, leaving no output", async () => {
    await encryptToFile(Readable.from([Buffer.from("hello world")]), join(dir, "b.enc"), key);
    await expect(
      decryptToFile(join(dir, "b.enc"), join(dir, "x"), randomBytes(32)),
    ).rejects.toThrow(/wrong key or the file was altered/);
    const altered = await readFile(join(dir, "b.enc"));
    altered[25] ^= 1;
    await writeFile(join(dir, "b2.enc"), altered);
    await expect(decryptToFile(join(dir, "b2.enc"), join(dir, "y"), key)).rejects.toThrow();
    await expect(readFile(join(dir, "y"))).rejects.toThrow();
  });

  it("rejects a file that is not a backup", async () => {
    await writeFile(join(dir, "n.enc"), randomBytes(64));
    await expect(decryptToFile(join(dir, "n.enc"), join(dir, "o"), key)).rejects.toThrow(
      /not a BeautyFits backup/,
    );
  });
});

describe("backup configuration", () => {
  it("requires a 32-byte base64 key without echoing it", () => {
    expect(parseEncryptionKey(randomBytes(32).toString("base64"))).toHaveLength(32);
    expect(() => parseEncryptionKey("short-secret-value")).toThrow(/BACKUP_ENCRYPTION_KEY/);
    try {
      parseEncryptionKey("short-secret-value");
    } catch (error) {
      expect((error as Error).message).not.toContain("short-secret-value");
    }
  });

  it("applies defaults and validates retention counts", () => {
    const base = {
      DATABASE_URL: "postgresql://u:p@h:5432/db",
      BACKUP_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    };
    expect(readBackupConfig(base)).toMatchObject({ dir: ".backups", dailyKeep: 7, weeklyKeep: 4 });
    expect(() => readBackupConfig({ ...base, BACKUP_DAILY_KEEP: "0" })).toThrow(
      /BACKUP_DAILY_KEEP/,
    );
  });

  it("keeps the password out of the command line", () => {
    const { args, env } = pgConnection(
      "postgresql://bf:s%40cret@db.local:6543/shop?schema=public&sslmode=require",
    );
    expect(args).toEqual(["-h", "db.local", "-p", "6543", "-U", "bf", "-d", "shop"]);
    expect(args.join(" ")).not.toContain("s@cret");
    expect(env.PGPASSWORD).toBe("s@cret");
    expect(env.PGSSLMODE).toBe("require");
  });
});

describe("backup naming and retention", () => {
  const name = (stamp: string, tier: string, kind = "db") =>
    `beautyfits-${stamp}-${tier}.${kind}.enc`;

  it("stamps in UTC", () => {
    expect(backupStamp(new Date("2026-10-17T03:04:05.678Z"))).toBe("20261017T030405Z");
  });

  it("takes a weekly backup when none exists from the last 7 days", () => {
    const now = new Date("2026-10-17T02:00:00Z");
    expect(chooseTier([], now)).toBe("weekly");
    expect(chooseTier([name("20261012T020000Z", "weekly")], now)).toBe("daily");
    expect(
      chooseTier([name("20261010T015959Z", "weekly"), name("20261016T020000Z", "daily")], now),
    ).toBe("weekly");
  });

  it("keeps the newest N of each tier, both files of a backup together", () => {
    const files = [
      name("20261010T000000Z", "weekly"),
      name("20261010T000000Z", "weekly", "media"),
      name("20261011T000000Z", "daily"),
      name("20261011T000000Z", "daily", "media"),
      name("20261012T000000Z", "daily"),
      name("20261013T000000Z", "daily"),
      name("20261017T000000Z", "weekly"),
      "unrelated.txt",
      name("20261009T000000Z", "daily") + ".partial",
    ];
    expect(expiredBackups(files, { daily: 2, weekly: 1 }).sort()).toEqual(
      [
        name("20261010T000000Z", "weekly"),
        name("20261010T000000Z", "weekly", "media"),
        name("20261011T000000Z", "daily"),
        name("20261011T000000Z", "daily", "media"),
      ].sort(),
    );
  });
});

describe("restore drill checks", () => {
  const stats = (over: Partial<DatabaseStats> = {}): DatabaseStats => ({
    migrations: ["a", "b"],
    rowCounts: { orders: 3, wallets: 2 },
    invariantViolations: { walletBalanceEqualsLedger: 0, inventoryEqualsMovements: 0 },
    ...over,
  });

  it("passes identical copies", () => {
    expect(compareStats(stats(), stats())).toEqual([]);
  });

  it("reports migration, row count and invariant differences", () => {
    const problems = compareStats(
      stats(),
      stats({
        migrations: ["a"],
        rowCounts: { orders: 2 },
        invariantViolations: { walletBalanceEqualsLedger: 1, inventoryEqualsMovements: 0 },
      }),
    );
    expect(problems).toEqual([
      "Migrations differ: source has 2, restored has 1.",
      "Row count of orders: source 3, restored 2.",
      "Row count of wallets: source 2, restored missing.",
      "Invariant walletBalanceEqualsLedger broken in 1 rows of the restored copy.",
    ]);
  });

  it("compares media checksums", () => {
    expect(compareMedia({ a: "1", b: "2" }, { a: "1", b: "2" })).toEqual([]);
    expect(compareMedia({ a: "1", b: "2" }, { a: "x", c: "3" })).toHaveLength(3);
  });

  it("uses a scratch database that can never be the source or the dev database", () => {
    expect(scratchDatabaseUrl("postgresql://u:p@h:5432/beautyfits?schema=public")).toBe(
      "postgresql://u:p@h:5432/beautyfits_drill?schema=public",
    );
    expect(scratchDatabaseUrl("postgresql://u:p@h:5432/shop_test")).toContain("/shop_test_drill");
    expect(() => scratchDatabaseUrl("postgresql://u:p@h:5432/x_drill")).toThrow(/Refusing/);
    expect(() => scratchDatabaseUrl("postgresql://u:p@h:5432/Bad-Name")).toThrow(/Refusing/);
  });
});
