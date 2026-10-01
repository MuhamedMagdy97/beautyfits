import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/server/db/client";
import { createLogger } from "@/server/logging/logger";
import { createScryptHasher } from "@/server/modules/auth/password-hash";
import { BootstrapError, runBootstrap } from "@/server/modules/bootstrap/bootstrap";
import { DEFAULT_ROLES } from "@/server/modules/bootstrap/default-roles";
import { runDevSeed, SAMPLE_STAFF } from "@/server/modules/bootstrap/dev-seed";
import { effectivePermissions } from "@/server/modules/rbac/authorization";
import { PERMISSION_CODES } from "@/server/modules/rbac/catalog";
import { readStaffSessionSettings, SETTING_KEYS } from "@/server/modules/settings/settings";
import { MS_PER_HOUR, MS_PER_MINUTE } from "@/server/time/time";
import { resetDatabase } from "@/test/integration/database";

/** Production bootstrap, settings and development seed (TASK-004) against the test database. */

const db = getDb();
const clock = { now: () => new Date("2026-10-01T10:00:00.000Z") };
const hasher = createScryptHasher({ N: 1024, r: 8, p: 1, keyLength: 32, saltLength: 16 });
const logLines: string[] = [];
const logger = createLogger({ level: "debug", write: (_level, line) => logLines.push(line) });
const deps = { db, clock, hasher, logger };

const PASSWORD = "saffron harbour under quiet lamps";
const OWNER = { email: "Owner@BeautyFits.example", password: PASSWORD, displayName: "Magdy" };

async function owners() {
  return db.employee.findMany({ where: { employeeLevel: "OWNER" }, include: { account: true } });
}

beforeEach(async () => {
  await resetDatabase();
  logLines.length = 0;
});

afterAll(async () => {
  await resetDatabase();
});

describe("runBootstrap", () => {
  it("seeds settings and default roles, and reports a missing Owner", async () => {
    const report = await runBootstrap(deps);
    expect(report.owner).toBe("MISSING");
    expect(report.settingsCreated.sort()).toEqual(
      [
        SETTING_KEYS.staffSessionIdleTimeoutMinutes,
        SETTING_KEYS.staffSessionMaxLifetimeMinutes,
      ].sort(),
    );
    expect(report.rolesCreated).toEqual(DEFAULT_ROLES.map((role) => role.name));

    for (const expected of DEFAULT_ROLES) {
      const role = await db.role.findUniqueOrThrow({
        where: { id: expected.id },
        include: { permissions: { include: { permission: true } } },
      });
      expect(role.name).toBe(expected.name);
      expect(role.isSystemRole).toBe(false);
      expect(role.createdByEmployeeId).toBeNull();
      expect(role.permissions.map((rp) => rp.permission.code).sort()).toEqual(
        [...expected.permissions].sort(),
      );
    }
    expect(await owners()).toHaveLength(0);
  });

  it("creates the first Owner, active and verified, who can sign in with the password", async () => {
    const report = await runBootstrap(deps, { owner: OWNER });
    expect(report.owner).toBe("CREATED");

    const [owner] = await owners();
    expect(owner.displayName).toBe("Magdy");
    expect(owner.status).toBe("ACTIVE");
    expect(owner.createdByEmployeeId).toBeNull();
    expect(owner.account.email).toBe("owner@beautyfits.example");
    expect(owner.account.accountType).toBe("EMPLOYEE");
    expect(owner.account.status).toBe("ACTIVE");
    expect(owner.account.emailVerifiedAt).not.toBeNull();
    expect(await hasher.verify(PASSWORD, owner.account.passwordHash)).toBe(true);
    expect((await effectivePermissions(db, owner)).size).toBe(PERMISSION_CODES.length);

    // Nothing secret is logged.
    expect(logLines.join("\n")).not.toContain(PASSWORD);
    expect(logLines.join("\n")).not.toContain("owner@beautyfits.example");
  });

  it("is idempotent and never changes an existing Owner or the Owner's role edits", async () => {
    await runBootstrap(deps, { owner: OWNER });
    const [before] = await owners();

    // The Owner renames one default role and edits another.
    const renamed = DEFAULT_ROLES[0];
    await db.role.update({ where: { id: renamed.id }, data: { name: "Stock Lead" } });
    const edited = DEFAULT_ROLES[5];
    await db.rolePermission.deleteMany({ where: { roleId: edited.id } });
    await db.setting.update({
      where: { key: SETTING_KEYS.staffSessionIdleTimeoutMinutes },
      data: { valueJson: 30 },
    });

    const again = await runBootstrap(deps, {
      owner: { email: "someone.else@beautyfits.example", password: "another long passphrase here" },
    });
    expect(again).toEqual({ settingsCreated: [], rolesCreated: [], owner: "EXISTS" });

    const [after] = await owners();
    expect(after.id).toBe(before.id);
    expect(after.account.passwordHash).toBe(before.account.passwordHash);
    expect(await owners()).toHaveLength(1);
    expect(await db.role.count()).toBe(DEFAULT_ROLES.length);
    expect((await db.role.findUniqueOrThrow({ where: { id: renamed.id } })).name).toBe(
      "Stock Lead",
    );
    expect(await db.rolePermission.count({ where: { roleId: edited.id } })).toBe(0);
    expect(
      (
        await db.setting.findUniqueOrThrow({
          where: { key: SETTING_KEYS.staffSessionIdleTimeoutMinutes },
        })
      ).valueJson,
    ).toBe(30);
  });

  it("skips a default role whose name another role already uses", async () => {
    await db.role.create({ data: { name: "catalog editor" } });
    const report = await runBootstrap(deps);
    expect(report.rolesCreated).not.toContain("Catalog Editor");
    expect(await db.role.count()).toBe(DEFAULT_ROLES.length);
  });

  it("creates exactly one Owner when two bootstraps run at once", async () => {
    const results = await Promise.all([
      runBootstrap(deps, { owner: OWNER }),
      runBootstrap(deps, {
        owner: { email: "second@beautyfits.example", password: "another long passphrase here" },
      }),
    ]);
    expect(results.map((r) => r.owner).sort()).toEqual(["CREATED", "EXISTS"]);
    expect(await owners()).toHaveLength(1);
    expect(await db.role.count()).toBe(DEFAULT_ROLES.length);
  });

  it("allows a customer with the Owner email (R15) but not another employee account", async () => {
    await db.account.create({
      data: {
        accountType: "CUSTOMER",
        email: "owner@beautyfits.example",
        emailVerifiedAt: clock.now(),
        passwordHash: "x",
        status: "ACTIVE",
      },
    });
    await db.account.create({
      data: {
        accountType: "EMPLOYEE",
        email: "taken@beautyfits.example",
        emailVerifiedAt: clock.now(),
        passwordHash: "x",
        status: "ACTIVE",
      },
    });
    await expect(
      runBootstrap(deps, { owner: { email: "taken@beautyfits.example", password: PASSWORD } }),
    ).rejects.toBeInstanceOf(BootstrapError);
    expect((await runBootstrap(deps, { owner: OWNER })).owner).toBe("CREATED");
  });

  it("changes nothing when the Owner password breaks the policy", async () => {
    await expect(
      runBootstrap(deps, { owner: { email: "owner@beautyfits.example", password: "password" } }),
    ).rejects.toBeInstanceOf(BootstrapError);
    expect(await db.setting.count()).toBe(0);
    expect(await db.role.count()).toBe(0);
    expect(await db.account.count()).toBe(0);
  });

  it("audits the seeded roles and the first Owner as SYSTEM actions, once (TASK-013)", async () => {
    await runBootstrap(deps, { owner: OWNER });
    await runBootstrap(deps, { owner: OWNER });
    const [owner] = await owners();
    const rows = await db.auditLog.findMany({ orderBy: { createdAt: "asc" } });
    expect(rows.filter((r) => r.action === "ROLE_SEEDED").map((r) => r.entityId)).toEqual(
      DEFAULT_ROLES.map((role) => role.id),
    );
    const ownerEntries = rows.filter((r) => r.action === "OWNER_BOOTSTRAPPED");
    expect(ownerEntries).toHaveLength(1);
    expect(ownerEntries[0]).toMatchObject({
      actorType: "SYSTEM",
      actorId: null,
      entityType: "EMPLOYEE",
      entityId: owner.id,
      newDataJson: { displayName: "Magdy", level: "OWNER" },
    });
    expect(JSON.stringify(rows)).not.toMatch(/owner@beautyfits|saffron/i);
  });
});

describe("readStaffSessionSettings", () => {
  it("uses the R29 defaults without rows, stored values, and defaults for invalid rows", async () => {
    const defaults = { maxLifetimeMs: 12 * MS_PER_HOUR, idleTimeoutMs: 60 * MS_PER_MINUTE };
    expect(await readStaffSessionSettings(db, logger)).toEqual(defaults);

    await runBootstrap(deps);
    expect(await readStaffSessionSettings(db, logger)).toEqual(defaults);

    await db.setting.update({
      where: { key: SETTING_KEYS.staffSessionMaxLifetimeMinutes },
      data: { valueJson: 480 },
    });
    await db.setting.update({
      where: { key: SETTING_KEYS.staffSessionIdleTimeoutMinutes },
      data: { valueJson: "soon" },
    });
    expect(await readStaffSessionSettings(db, logger)).toEqual({
      maxLifetimeMs: 8 * MS_PER_HOUR,
      idleTimeoutMs: 60 * MS_PER_MINUTE,
    });
    expect(logLines.some((line) => line.includes("settings.invalid_value"))).toBe(true);
  });
});

describe("runDevSeed", () => {
  const input = { password: "olive window beside the river", nodeEnv: "development" };

  it("refuses production and needs an Owner", async () => {
    await expect(runDevSeed(deps, { ...input, nodeEnv: "production" })).rejects.toThrow(
      /production/,
    );
    await runBootstrap(deps);
    await expect(runDevSeed(deps, input)).rejects.toThrow(/No Owner/);
  });

  it("adds the sample staff with their roles, once", async () => {
    await runBootstrap(deps, { owner: OWNER });
    const first = await runDevSeed(deps, input);
    expect(first.staffCreated).toEqual(SAMPLE_STAFF.map((s) => s.email));
    expect((await runDevSeed(deps, input)).staffCreated).toEqual([]);

    const [owner] = await owners();
    for (const sample of SAMPLE_STAFF) {
      const account = await db.account.findFirstOrThrow({
        where: { accountType: "EMPLOYEE", email: sample.email },
        include: { employee: true },
      });
      expect(account.employee?.employeeLevel).toBe(sample.level);
      expect(account.employee?.createdByEmployeeId).toBe(owner.id);
      const role = DEFAULT_ROLES.find((r) => r.name === sample.roleName)!;
      expect([...(await effectivePermissions(db, account.employee!))].sort()).toEqual(
        [...role.permissions].sort(),
      );
    }
  });
});
