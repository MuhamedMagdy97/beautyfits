import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BootstrapError,
  DEFAULT_OWNER_DISPLAY_NAME,
  parseOwnerInput,
} from "@/server/modules/bootstrap/bootstrap";
import { devSeedPasswordFromEnv, ownerFromEnv } from "@/server/modules/bootstrap/cli";
import { DEFAULT_ROLES } from "@/server/modules/bootstrap/default-roles";
import { SAMPLE_STAFF } from "@/server/modules/bootstrap/dev-seed";
import { isPermissionCode, OWNER_ADMIN_ONLY_PERMISSIONS } from "@/server/modules/rbac/catalog";
import { inviteEmployeeSchema } from "@/server/modules/rbac/schemas";
import { SETTING_DEFINITIONS, SETTING_KEYS } from "@/server/modules/settings/settings";

/** Bootstrap data and command-line settings (TASK-004, ADR-0017). */

const catalogDoc = readFileSync("docs/security/permission-catalog.md", "utf8");

/** Rows of the §3 table: role name (bold) and its comma-separated permissions. */
function documentedDefaultRoles(): { name: string; permissions: string[] }[] {
  const section = catalogDoc.split("## 3.")[1].split("## 4.")[0];
  return section
    .split("\n")
    .filter((line) => line.startsWith("| **"))
    .map((line) => {
      const cells = line.split("|").map((cell) => cell.trim());
      return {
        name: /\*\*(.+?)\*\*/.exec(cells[1])![1],
        permissions: cells[2].split(",").map((code) => code.trim()),
      };
    });
}

function documentedNotInAnyRole(): string[] {
  const line = catalogDoc
    .split("\n")
    .find((l) => l.startsWith("Not included in any default role"))!;
  return line
    .split(":")[1]
    .split(",")
    .map((code) => code.trim().replace(/\.$/, ""));
}

describe("default roles", () => {
  it("match docs/security/permission-catalog.md §3 exactly", () => {
    const documented = documentedDefaultRoles();
    expect(documented).toHaveLength(7);
    expect(
      DEFAULT_ROLES.map((role) => ({ name: role.name, permissions: [...role.permissions].sort() })),
    ).toEqual(documented.map((role) => ({ ...role, permissions: role.permissions.sort() })));
  });

  it("use only catalog codes, never an Owner/Admin-only or excluded permission", () => {
    const excluded = new Set(documentedNotInAnyRole());
    expect(excluded.size).toBe(13);
    for (const role of DEFAULT_ROLES) {
      for (const code of role.permissions) {
        expect(isPermissionCode(code)).toBe(true);
        expect(OWNER_ADMIN_ONLY_PERMISSIONS.has(code)).toBe(false);
        expect(excluded.has(code)).toBe(false);
      }
      expect(new Set(role.permissions).size).toBe(role.permissions.length);
    }
  });

  it("have fixed, distinct, valid ids", () => {
    const ids = DEFAULT_ROLES.map((role) => role.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(inviteEmployeeSchema.shape.roleIds.safeParse([id]).success).toBe(true);
    }
  });
});

describe("default settings", () => {
  it("are the R29 staff session lengths, in minutes", () => {
    const byKey = new Map(SETTING_DEFINITIONS.map((d) => [d.key, d]));
    expect(byKey.get(SETTING_KEYS.staffSessionMaxLifetimeMinutes)?.defaultValue).toBe(12 * 60);
    expect(byKey.get(SETTING_KEYS.staffSessionIdleTimeoutMinutes)?.defaultValue).toBe(60);
    for (const definition of SETTING_DEFINITIONS) {
      expect(definition.isValid(definition.defaultValue)).toBe(true);
      for (const bad of [0, -5, 1.5, "60", null]) {
        expect(definition.isValid(bad)).toBe(false);
      }
    }
  });
});

describe("Owner details", () => {
  const strong = "saffron harbour under quiet lamps";

  it("are normalized and get a default display name", () => {
    expect(parseOwnerInput({ email: "  Owner@Example.COM ", password: strong })).toEqual({
      email: "owner@example.com",
      password: strong,
      displayName: DEFAULT_OWNER_DISPLAY_NAME,
    });
  });

  it("reject an invalid email or a password that breaks the policy (Q156)", () => {
    expect(() => parseOwnerInput({ email: "not-an-email", password: strong })).toThrow(
      BootstrapError,
    );
    expect(() => parseOwnerInput({ email: "owner@example.com", password: "short" })).toThrow(
      /at least 12 characters/,
    );
  });

  it("come from both variables or neither", () => {
    expect(ownerFromEnv({})).toBeNull();
    expect(ownerFromEnv({ BOOTSTRAP_OWNER_EMAIL: " ", BOOTSTRAP_OWNER_PASSWORD: "" })).toBeNull();
    expect(() => ownerFromEnv({ BOOTSTRAP_OWNER_EMAIL: "owner@example.com" })).toThrow(
      BootstrapError,
    );
    expect(() => ownerFromEnv({ BOOTSTRAP_OWNER_PASSWORD: strong })).toThrow(BootstrapError);
    expect(
      ownerFromEnv({
        BOOTSTRAP_OWNER_EMAIL: "owner@example.com",
        BOOTSTRAP_OWNER_PASSWORD: strong,
        BOOTSTRAP_OWNER_NAME: " Magda ",
      }),
    ).toEqual({ email: "owner@example.com", password: strong, displayName: "Magda" });
  });

  it("require DEV_SEED_PASSWORD for the development seed", () => {
    expect(() => devSeedPasswordFromEnv({})).toThrow(BootstrapError);
    expect(devSeedPasswordFromEnv({ DEV_SEED_PASSWORD: strong })).toBe(strong);
  });
});

describe("no public way to create an Owner", () => {
  function routeFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory()
        ? routeFiles(join(dir, entry.name))
        : entry.name === "route.ts"
          ? [join(dir, entry.name)]
          : [],
    );
  }

  it("no API route uses the bootstrap", () => {
    const files = routeFiles("src/app");
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      expect(readFileSync(file, "utf8")).not.toMatch(/modules\/bootstrap/);
    }
  });

  it("invitations never create an Owner", () => {
    const result = inviteEmployeeSchema.safeParse({
      email: "x@example.com",
      displayName: "X",
      level: "OWNER",
    });
    expect(result.success).toBe(false);
  });

  it("sample staff use the reserved .example domain and default role names", () => {
    const roleNames = new Set(DEFAULT_ROLES.map((role) => role.name));
    for (const sample of SAMPLE_STAFF) {
      expect(sample.email).toMatch(/@beautyfits\.example$/);
      expect(roleNames.has(sample.roleName)).toBe(true);
    }
  });
});
