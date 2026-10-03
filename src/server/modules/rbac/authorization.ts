import type { EmployeeLevel } from "@/generated/prisma/client";
import { getDb } from "@/server/db/client";
import type { Db } from "@/server/db/transaction";
import { AppError } from "@/server/errors/app-error";
import type { EmployeeAuthService } from "@/server/modules/auth/employee-auth-service";
import { requireEmployee, type AuthenticatedEmployee } from "@/server/modules/auth/employee-guard";
import {
  isPermissionCode,
  OWNER_ADMIN_ONLY_PERMISSIONS,
  PERMISSION_CODES,
  type PermissionCode,
} from "@/server/modules/rbac/catalog";

/**
 * Backend authorization (TASK-012, Architecture §6, permission catalog).
 *
 * - Owner and Admin hold every permission (User Flows §2; permission catalog §3).
 * - Managers and Employees hold the union of their roles' permissions, minus
 *   the Owner/Admin-only permissions (permission catalog §2), whatever a role
 *   contains.
 *
 * Permissions are read from the database on every request, so a role edit,
 * a role change or a deactivation applies to the next request.
 */

export type PermissionSet = ReadonlySet<PermissionCode>;

const ALL_PERMISSIONS: PermissionSet = new Set(PERMISSION_CODES);

export function hasFullAccess(level: EmployeeLevel): boolean {
  return level === "OWNER" || level === "ADMIN";
}

/** Applies the level rules to the permissions granted by roles. */
export function permissionsForLevel(
  level: EmployeeLevel,
  granted: Iterable<string>,
): PermissionSet {
  if (hasFullAccess(level)) {
    return ALL_PERMISSIONS;
  }
  const result = new Set<PermissionCode>();
  for (const code of granted) {
    if (isPermissionCode(code) && !OWNER_ADMIN_ONLY_PERMISSIONS.has(code)) {
      result.add(code);
    }
  }
  return result;
}

/** The permission codes of a set of roles (union). */
export async function rolePermissionCodes(db: Db, roleIds: readonly string[]): Promise<string[]> {
  if (roleIds.length === 0) {
    return [];
  }
  const rows = await db.rolePermission.findMany({
    where: { roleId: { in: [...roleIds] } },
    select: { permission: { select: { code: true } } },
  });
  return rows.map((row) => row.permission.code);
}

/** The effective permissions of an employee. */
export async function effectivePermissions(
  db: Db,
  employee: { id: string; employeeLevel: EmployeeLevel },
): Promise<PermissionSet> {
  if (hasFullAccess(employee.employeeLevel)) {
    return ALL_PERMISSIONS;
  }
  const rows = await db.rolePermission.findMany({
    where: { role: { employees: { some: { employeeId: employee.id } } } },
    select: { permission: { select: { code: true } } },
  });
  return permissionsForLevel(
    employee.employeeLevel,
    rows.map((row) => row.permission.code),
  );
}

/** Catalog order, for stable responses. */
export function sortedCodes(permissions: PermissionSet): PermissionCode[] {
  return PERMISSION_CODES.filter((code) => permissions.has(code));
}

export function permissionDenied(
  message = "You do not have permission to do this.",
  details: Record<string, unknown> = {},
): AppError {
  return new AppError("PERMISSION_DENIED", message, { details });
}

export interface AuthorizedEmployee extends AuthenticatedEmployee {
  level: EmployeeLevel;
  permissions: PermissionSet;
}

export interface AuthorizationOptions {
  db?: Db;
  service?: EmployeeAuthService;
}

/**
 * Authenticates an employee (`requireEmployee`) and loads their effective
 * permissions. Use `requirePermission` for endpoints guarded by a code.
 */
export async function requireStaff(
  request: Request,
  options: AuthorizationOptions = {},
): Promise<AuthorizedEmployee> {
  const employee = await requireEmployee(request, { service: options.service });
  const level = employee.view.employee.level;
  const permissions = await effectivePermissions(options.db ?? getDb(), {
    id: employee.employeeId,
    employeeLevel: level,
  });
  return { ...employee, level, permissions };
}

/**
 * Authenticates an employee and requires every listed permission
 * (`403 PERMISSION_DENIED` otherwise, API contract §6.1). Session errors
 * keep their meaning: `401 UNAUTHENTICATED`, `403 FORBIDDEN`.
 */
export async function requirePermission(
  request: Request,
  required: PermissionCode | readonly PermissionCode[],
  options: AuthorizationOptions = {},
): Promise<AuthorizedEmployee> {
  const employee = await requireStaff(request, options);
  const codes = typeof required === "string" ? [required] : required;
  const missing = codes.filter((code) => !employee.permissions.has(code));
  if (missing.length > 0) {
    throw permissionDenied("You do not have permission to do this.", {
      requiredPermissions: missing,
    });
  }
  return employee;
}

/** Like `requirePermission`, but one of the listed permissions is enough. */
export async function requireAnyPermission(
  request: Request,
  anyOf: readonly PermissionCode[],
  options: AuthorizationOptions = {},
): Promise<AuthorizedEmployee> {
  const employee = await requireStaff(request, options);
  if (!anyOf.some((code) => employee.permissions.has(code))) {
    throw permissionDenied("You do not have permission to do this.", {
      requiredPermissions: anyOf,
      anyOf: true,
    });
  }
  return employee;
}
