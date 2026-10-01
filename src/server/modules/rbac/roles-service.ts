import type { PrismaClient } from "@/generated/prisma/client";
import { getDb } from "@/server/db/client";
import { runInTransaction, type Db } from "@/server/db/transaction";
import { AppError } from "@/server/errors/app-error";
import type { Logger } from "@/server/logging/logger";
import { AUDIT_ENTITY_TYPES, employeeActor, recordAudit } from "@/server/modules/audit/audit";
import { permissionDenied } from "@/server/modules/rbac/authorization";
import {
  OWNER_ADMIN_ONLY_PERMISSIONS,
  PERMISSION_CATALOG,
  PERMISSION_CODES,
  type PermissionCode,
  type PermissionGroup,
} from "@/server/modules/rbac/catalog";
import { systemClock, type Clock } from "@/server/time/time";

/**
 * Roles and the permission catalog (TASK-012, Q66, Q67, User Flows §17.1).
 * Custom roles are created and edited by Owner/Admin only (`ROLE_MANAGE` is
 * an Owner/Admin-only permission). System roles cannot be edited. Roles are
 * never deleted.
 */

export interface RoleView {
  id: string;
  name: string;
  description: string | null;
  isSystemRole: boolean;
  permissions: PermissionCode[];
  employeeCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface PermissionView {
  code: PermissionCode;
  group: PermissionGroup;
  description: string;
  /** Never granted to Managers or Employees (permission catalog §2). */
  ownerAdminOnly: boolean;
}

export interface RoleActor {
  employeeId: string;
}

export interface RoleInput {
  name: string;
  description?: string | null;
  permissions: PermissionCode[];
}

export interface RolesServiceDeps {
  db: PrismaClient;
  clock: Clock;
}

const roleInclude = {
  permissions: { select: { permission: { select: { code: true } } } },
  _count: { select: { employees: true } },
} as const;

type RoleRow = {
  id: string;
  name: string;
  description: string | null;
  isSystemRole: boolean;
  createdAt: Date;
  updatedAt: Date;
  permissions: { permission: { code: string } }[];
  _count: { employees: number };
};

function toRoleView(role: RoleRow): RoleView {
  const codes = new Set(role.permissions.map((p) => p.permission.code));
  return {
    id: role.id,
    name: role.name,
    description: role.description,
    isSystemRole: role.isSystemRole,
    permissions: PERMISSION_CODES.filter((code) => codes.has(code)),
    employeeCount: role._count.employees,
    createdAt: role.createdAt.toISOString(),
    updatedAt: role.updatedAt.toISOString(),
  };
}

export function permissionCatalogView(): PermissionView[] {
  return PERMISSION_CATALOG.map((entry) => ({
    code: entry.code,
    group: entry.group,
    description: entry.description,
    ownerAdminOnly: OWNER_ADMIN_ONLY_PERMISSIONS.has(entry.code),
  }));
}

/** What an audit entry records about a role. */
function roleSnapshot(role: Pick<RoleView, "name" | "description" | "permissions">) {
  return { name: role.name, description: role.description, permissions: role.permissions };
}

function roleNotFound(): AppError {
  return new AppError("NOT_FOUND", "Role not found.");
}

/**
 * A custom role exists to be given to Managers and Employees, who can never
 * hold the Owner/Admin-only permissions, so a role must not contain them.
 */
function assertAssignablePermissions(codes: readonly PermissionCode[]): void {
  const reserved = codes.filter((code) => OWNER_ADMIN_ONLY_PERMISSIONS.has(code));
  if (reserved.length > 0) {
    throw new AppError("VALIDATION_ERROR", "Request validation failed.", {
      details: {
        issues: [
          {
            path: "permissions",
            code: "permission_owner_admin_only",
            message: `Only the Owner and Admins can hold: ${reserved.join(", ")}.`,
          },
        ],
      },
    });
  }
}

/** Role names are unique ignoring case. Call inside the role-name lock. */
async function assertNameFree(tx: Db, name: string, exceptId?: string): Promise<void> {
  const clash = await tx.role.findFirst({
    where: {
      name: { equals: name, mode: "insensitive" },
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
    select: { id: true },
  });
  if (clash) {
    throw new AppError("CONFLICT", "A role with this name already exists.", {
      details: { reason: "ROLE_NAME_TAKEN" },
    });
  }
}

export async function lockRoleNames(tx: Db): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('rbac:role-names'))`;
}

async function permissionIds(tx: Db, codes: readonly PermissionCode[]): Promise<string[]> {
  const unique = [...new Set(codes)];
  if (unique.length === 0) {
    return [];
  }
  const rows = await tx.permission.findMany({
    where: { code: { in: unique } },
    select: { id: true },
  });
  if (rows.length !== unique.length) {
    // The migrations and the code catalog disagree: a deployment error.
    throw new Error("Permission catalog rows are missing from the database");
  }
  return rows.map((row) => row.id);
}

export function createRolesService(deps: RolesServiceDeps) {
  const { db, clock } = deps;

  async function listRoles(): Promise<RoleView[]> {
    const roles = await db.role.findMany({
      include: roleInclude,
      orderBy: [{ isSystemRole: "desc" }, { name: "asc" }],
    });
    return roles.map(toRoleView);
  }

  async function createRole(
    actor: RoleActor,
    input: RoleInput,
    logger: Logger,
    correlationId: string | null = null,
  ): Promise<RoleView> {
    assertAssignablePermissions(input.permissions);
    const now = clock.now();
    const role = await runInTransaction(
      async (tx) => {
        await lockRoleNames(tx);
        await assertNameFree(tx, input.name);
        const ids = await permissionIds(tx, input.permissions);
        const created = await tx.role.create({
          data: {
            name: input.name,
            description: input.description ?? null,
            createdByEmployeeId: actor.employeeId,
            createdAt: now,
            updatedAt: now,
            permissions: { create: ids.map((permissionId) => ({ permissionId })) },
          },
          include: roleInclude,
        });
        await recordAudit(tx, {
          actor: employeeActor(actor.employeeId),
          action: "ROLE_CREATED",
          entityType: AUDIT_ENTITY_TYPES.role,
          entityId: created.id,
          next: roleSnapshot(toRoleView(created)),
          correlationId,
          createdAt: now,
        });
        return created;
      },
      {},
      db,
    );
    logger.info("role created", {
      roleId: role.id,
      actorEmployeeId: actor.employeeId,
      permissions: input.permissions,
    });
    return toRoleView(role);
  }

  async function updateRole(
    actor: RoleActor,
    roleId: string,
    input: Partial<RoleInput>,
    logger: Logger,
    correlationId: string | null = null,
  ): Promise<RoleView> {
    if (input.permissions) {
      assertAssignablePermissions(input.permissions);
    }
    const now = clock.now();
    const { role, before } = await runInTransaction(
      async (tx) => {
        await lockRoleNames(tx);
        const existing = await tx.role.findUnique({ where: { id: roleId }, include: roleInclude });
        if (!existing) {
          throw roleNotFound();
        }
        if (existing.isSystemRole) {
          throw permissionDenied("System roles cannot be changed.", { reason: "SYSTEM_ROLE" });
        }
        if (input.name !== undefined) {
          await assertNameFree(tx, input.name, roleId);
        }
        if (input.permissions) {
          const ids = await permissionIds(tx, input.permissions);
          await tx.rolePermission.deleteMany({ where: { roleId } });
          await tx.rolePermission.createMany({
            data: ids.map((permissionId) => ({ roleId, permissionId })),
          });
        }
        const updated = await tx.role.update({
          where: { id: roleId },
          data: {
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.description !== undefined ? { description: input.description } : {}),
            updatedAt: now,
          },
          include: roleInclude,
        });
        const before = toRoleView(existing);
        await recordAudit(tx, {
          actor: employeeActor(actor.employeeId),
          action: "ROLE_UPDATED",
          entityType: AUDIT_ENTITY_TYPES.role,
          entityId: roleId,
          previous: roleSnapshot(before),
          next: roleSnapshot(toRoleView(updated)),
          correlationId,
          createdAt: now,
        });
        return { role: updated, before };
      },
      {},
      db,
    );
    const after = toRoleView(role);
    logger.info("role updated", {
      roleId,
      actorEmployeeId: actor.employeeId,
      permissionsBefore: before.permissions,
      permissionsAfter: after.permissions,
    });
    return after;
  }

  return { listRoles, createRole, updateRole };
}

export type RolesService = ReturnType<typeof createRolesService>;

let defaultService: RolesService | undefined;

export function getRolesService(): RolesService {
  defaultService ??= createRolesService({ db: getDb(), clock: systemClock });
  return defaultService;
}
