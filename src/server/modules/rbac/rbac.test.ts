import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { generateToken, isWellFormedToken } from "@/server/modules/auth/tokens";
import { hasFullAccess, permissionsForLevel } from "@/server/modules/rbac/authorization";
import {
  OWNER_ADMIN_ONLY_PERMISSIONS,
  PERMISSION_CATALOG,
  PERMISSION_CODES,
  type PermissionCode,
} from "@/server/modules/rbac/catalog";
import { canAssignRole, canManageLevel, manageableLevels } from "@/server/modules/rbac/hierarchy";
import { invitationEmail, invitationLink } from "@/server/modules/rbac/invitation-email";
import {
  acceptInvitationSchema,
  createRoleSchema,
  inviteEmployeeSchema,
  updateEmployeeSchema,
  updateRoleSchema,
} from "@/server/modules/rbac/schemas";

const catalogDoc = readFileSync("docs/security/permission-catalog.md", "utf8");

/** Codes in the first column of the §1 tables (`A` / `B` rows hold two). */
function documentedCodes(): string[] {
  const section = catalogDoc.split("## 1. Permission catalog")[1].split("## 2.")[0];
  return section
    .split("\n")
    .filter((line) => line.startsWith("| `"))
    .flatMap((line) => [...line.split("|")[1].matchAll(/`([A-Z_]+)`/g)].map((m) => m[1]));
}

function documentedReserved(): string[] {
  const section = catalogDoc.split("## 2.")[1].split("## 3.")[0];
  return [...section.matchAll(/`([A-Z_]+)`/g)].map((m) => m[1]);
}

describe("permission catalog", () => {
  it("matches docs/security/permission-catalog.md §1 exactly", () => {
    expect([...PERMISSION_CODES].sort()).toEqual(documentedCodes().sort());
    expect(new Set(PERMISSION_CODES).size).toBe(PERMISSION_CODES.length);
  });

  it("reserves exactly the §2 permissions for Owner/Admin", () => {
    expect([...OWNER_ADMIN_ONLY_PERMISSIONS].sort()).toEqual(documentedReserved().sort());
  });

  it("gives every code a group and a description", () => {
    for (const entry of PERMISSION_CATALOG) {
      expect(entry.description.length).toBeGreaterThan(0);
      expect(entry.group.length).toBeGreaterThan(0);
    }
  });
});

describe("effective permissions by level", () => {
  const granted: PermissionCode[] = ["ORDERS_VIEW", "ADJUST_WALLET", "ROLE_MANAGE"];

  it("gives Owner and Admin every permission, whatever their roles", () => {
    for (const level of ["OWNER", "ADMIN"] as const) {
      expect(hasFullAccess(level)).toBe(true);
      expect(permissionsForLevel(level, []).size).toBe(PERMISSION_CODES.length);
    }
  });

  it("never gives Managers or Employees an Owner/Admin-only permission", () => {
    for (const level of ["MANAGER", "EMPLOYEE"] as const) {
      expect(hasFullAccess(level)).toBe(false);
      expect([...permissionsForLevel(level, granted)]).toEqual(["ORDERS_VIEW"]);
    }
  });

  it("ignores codes that are not in the catalog", () => {
    expect(permissionsForLevel("EMPLOYEE", ["NOT_A_PERMISSION"]).size).toBe(0);
  });
});

describe("staff hierarchy (Q65)", () => {
  it("lets the Owner manage Admins, Managers and Employees", () => {
    expect(manageableLevels("OWNER")).toEqual(["ADMIN", "MANAGER", "EMPLOYEE"]);
  });

  it("lets an Admin manage Managers and Employees only", () => {
    expect(canManageLevel("ADMIN", "MANAGER")).toBe(true);
    expect(canManageLevel("ADMIN", "EMPLOYEE")).toBe(true);
    expect(canManageLevel("ADMIN", "ADMIN")).toBe(false);
    expect(canManageLevel("ADMIN", "OWNER")).toBe(false);
  });

  it("lets a Manager manage Employees only, and an Employee nobody", () => {
    expect(manageableLevels("MANAGER")).toEqual(["EMPLOYEE"]);
    expect(manageableLevels("EMPLOYEE")).toEqual([]);
  });

  it("never makes anyone Owner", () => {
    for (const level of ["OWNER", "ADMIN", "MANAGER", "EMPLOYEE"] as const) {
      expect(canManageLevel(level, "OWNER")).toBe(false);
    }
  });

  it("lets a Manager assign only roles within their own permissions", () => {
    const manager = {
      level: "MANAGER" as const,
      permissions: new Set<PermissionCode>(["ORDERS_VIEW", "CONFIRM_ORDER"]),
    };
    expect(canAssignRole(manager, ["ORDERS_VIEW"])).toBe(true);
    expect(canAssignRole(manager, ["ORDERS_VIEW", "CANCEL_ORDER"])).toBe(false);
    expect(canAssignRole({ level: "ADMIN", permissions: new Set() }, ["CANCEL_ORDER"])).toBe(true);
  });
});

describe("request schemas", () => {
  it("normalizes the invited email and refuses the Owner level", () => {
    const parsed = inviteEmployeeSchema.parse({
      email: "  Sara@BeautyFits.Example ",
      displayName: " Sara ",
      level: "EMPLOYEE",
    });
    expect(parsed).toEqual({
      email: "sara@beautyfits.example",
      displayName: "Sara",
      level: "EMPLOYEE",
      roleIds: [],
    });
    expect(
      inviteEmployeeSchema.safeParse({ email: "a@b.example", displayName: "A", level: "OWNER" })
        .success,
    ).toBe(false);
  });

  it("requires at least one field on updates", () => {
    expect(updateEmployeeSchema.safeParse({}).success).toBe(false);
    expect(updateEmployeeSchema.parse({ department: "  " })).toEqual({ department: null });
    expect(updateRoleSchema.safeParse({}).success).toBe(false);
  });

  it("accepts only catalog permission codes in roles, without duplicates", () => {
    const parsed = createRoleSchema.parse({
      name: " Packers ",
      permissions: ["ORDERS_VIEW", "ORDERS_VIEW"],
    });
    expect(parsed).toEqual({ name: "Packers", permissions: ["ORDERS_VIEW"] });
    const bad = createRoleSchema.safeParse({ name: "X", permissions: ["FLY"] });
    expect(bad.success).toBe(false);
  });

  it("applies the password policy when accepting an invitation (Q156)", () => {
    expect(
      acceptInvitationSchema.safeParse({ invitationToken: "bfi_x", password: "short" }).success,
    ).toBe(false);
  });
});

describe("invitation email", () => {
  it("is bilingual and carries the link with the token in the fragment", () => {
    const token = generateToken("invite");
    expect(isWellFormedToken("invite", token)).toBe(true);
    const link = invitationLink("https://dash.beautyfits.example", token);
    expect(link).toBe(`https://dash.beautyfits.example/staff/accept-invitation#token=${token}`);
    const message = invitationEmail({
      to: "sara@beautyfits.example",
      displayName: "Sara",
      link,
      expiresAt: new Date("2026-10-08T10:00:00Z"),
    });
    expect(message.to).toBe("sara@beautyfits.example");
    expect(message.text.indexOf("مرحبًا")).toBeLessThan(message.text.indexOf("Hello"));
    expect(message.text).toContain(link);
    expect(message.text).toContain("2026-10-08 10:00 UTC");
  });
});
