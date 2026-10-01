import type { EmployeeLevel } from "@/generated/prisma/client";
import { hasFullAccess, type PermissionSet } from "@/server/modules/rbac/authorization";

/**
 * Staff hierarchy (Q65, User Flows §17.1, API contract §25; ADR-0016):
 * - the Owner invites and manages Admins, Managers and Employees;
 * - an Admin invites and manages Managers and Employees (never the Owner or
 *   another Admin);
 * - a Manager invites and manages Employees only;
 * - an Employee manages nobody and cannot assign roles.
 * Nobody is made Owner through the API (ownership transfer is out of scope).
 */
const MANAGEABLE_LEVELS: Record<EmployeeLevel, readonly EmployeeLevel[]> = {
  OWNER: ["ADMIN", "MANAGER", "EMPLOYEE"],
  ADMIN: ["MANAGER", "EMPLOYEE"],
  MANAGER: ["EMPLOYEE"],
  EMPLOYEE: [],
};

export function manageableLevels(actor: EmployeeLevel): readonly EmployeeLevel[] {
  return MANAGEABLE_LEVELS[actor];
}

export function canManageLevel(actor: EmployeeLevel, target: EmployeeLevel): boolean {
  return MANAGEABLE_LEVELS[actor].includes(target);
}

/**
 * A Manager may give or take away only roles whose every permission they hold
 * themselves (permission catalog: "cannot grant permissions they do not
 * hold"). Owner and Admin may assign any custom role.
 */
export function canAssignRole(
  actor: { level: EmployeeLevel; permissions: PermissionSet },
  rolePermissionCodes: readonly string[],
): boolean {
  if (hasFullAccess(actor.level)) {
    return true;
  }
  const held: ReadonlySet<string> = actor.permissions;
  return rolePermissionCodes.every((code) => held.has(code));
}
