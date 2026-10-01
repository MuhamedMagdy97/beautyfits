import type {
  EmployeeLevel,
  EmployeeStatus,
  Prisma,
  PrismaClient,
} from "@/generated/prisma/client";
import { getEnv } from "@/server/config/env";
import { getDb } from "@/server/db/client";
import { runInTransaction, type Db } from "@/server/db/transaction";
import { getEmailSender, type EmailSender } from "@/server/email/email";
import { AppError } from "@/server/errors/app-error";
import type { Pagination } from "@/server/http/response";
import type { Logger } from "@/server/logging/logger";
import type { RequestMeta } from "@/server/modules/auth/auth-service";
import { emailDigest, OTP_VERIFY_IP_LIMIT } from "@/server/modules/auth/otp";
import { createScryptHasher, type PasswordHasher } from "@/server/modules/auth/password-hash";
import { revokeAccountSessions } from "@/server/modules/auth/sessions";
import { generateToken, hashToken, isWellFormedToken } from "@/server/modules/auth/tokens";
import {
  effectivePermissions,
  permissionDenied,
  type PermissionSet,
} from "@/server/modules/rbac/authorization";
import { canAssignRole, canManageLevel } from "@/server/modules/rbac/hierarchy";
import { invitationEmail, invitationLink } from "@/server/modules/rbac/invitation-email";
import { getBlockedUntil, recordHit, secondsUntil } from "@/server/rate-limit/rate-limit";
import { MS_PER_DAY, systemClock, type Clock } from "@/server/time/time";

/**
 * Employee management (TASK-012): invitations by work email (Q64), editing
 * employees and their roles within the hierarchy (Q65), deactivation that
 * keeps history (Q69), and accepting an invitation.
 * Rules: User Flows §17, API contract §25, permission catalog; technical
 * choices and defaults in ADR-0016.
 */

export const EMPLOYEE_MANAGEMENT_POLICY = {
  /** An invitation can be accepted for 7 days (ADR-0016 default). */
  invitationTtlMs: 7 * MS_PER_DAY,
} as const;

export interface StaffActor {
  employeeId: string;
  accountId: string;
  level: EmployeeLevel;
  permissions: PermissionSet;
}

export interface RoleRef {
  id: string;
  name: string;
}

export interface EmployeeListView {
  id: string;
  accountId: string;
  email: string;
  displayName: string;
  level: EmployeeLevel;
  department: string | null;
  status: EmployeeStatus;
  roles: RoleRef[];
  createdByEmployeeId: string | null;
  createdAt: string;
  deactivatedAt: string | null;
}

export type InvitationStatus = "PENDING" | "ACCEPTED" | "REVOKED" | "EXPIRED";

export interface InvitationView {
  id: string;
  email: string;
  displayName: string;
  department: string | null;
  level: EmployeeLevel;
  roles: RoleRef[];
  status: InvitationStatus;
  invitedBy: { id: string; displayName: string };
  expiresAt: string;
  createdAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
}

export interface Page<T> {
  items: T[];
  pagination: Pagination;
}

export interface PageQuery {
  page: number;
  pageSize: number;
}

export interface EmployeeManagementDeps {
  db: PrismaClient;
  clock: Clock;
  hasher: PasswordHasher;
  email?: EmailSender;
  /** Dashboard origin for invitation links; defaults to `DASHBOARD_URL`. */
  dashboardUrl?: () => string;
}

const employeeInclude = {
  account: { select: { email: true } },
  roles: {
    select: { role: { select: { id: true, name: true } } },
    orderBy: { role: { name: "asc" } },
  },
} as const satisfies Prisma.EmployeeInclude;

type EmployeeRow = Prisma.EmployeeGetPayload<{ include: typeof employeeInclude }>;

const invitationInclude = {
  invitedBy: { select: { id: true, displayName: true } },
} as const satisfies Prisma.EmployeeInvitationInclude;

type InvitationRow = Prisma.EmployeeInvitationGetPayload<{ include: typeof invitationInclude }>;

function toEmployeeView(row: EmployeeRow): EmployeeListView {
  return {
    id: row.id,
    accountId: row.accountId,
    email: row.account.email,
    displayName: row.displayName,
    level: row.employeeLevel,
    department: row.department,
    status: row.status,
    roles: row.roles.map((r) => ({ id: r.role.id, name: r.role.name })),
    createdByEmployeeId: row.createdByEmployeeId,
    createdAt: row.createdAt.toISOString(),
    deactivatedAt: row.deactivatedAt?.toISOString() ?? null,
  };
}

function roleIdsOf(invitation: { roleIdsJson: Prisma.JsonValue }): string[] {
  const value = invitation.roleIdsJson;
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
}

function invitationStatus(
  invitation: { acceptedAt: Date | null; revokedAt: Date | null; expiresAt: Date },
  now: Date,
): InvitationStatus {
  if (invitation.acceptedAt) {
    return "ACCEPTED";
  }
  if (invitation.revokedAt) {
    return "REVOKED";
  }
  return invitation.expiresAt <= now ? "EXPIRED" : "PENDING";
}

function statusWhere(status: InvitationStatus, now: Date): Prisma.EmployeeInvitationWhereInput {
  switch (status) {
    case "ACCEPTED":
      return { acceptedAt: { not: null } };
    case "REVOKED":
      return { acceptedAt: null, revokedAt: { not: null } };
    case "EXPIRED":
      return { acceptedAt: null, revokedAt: null, expiresAt: { lte: now } };
    case "PENDING":
      return { acceptedAt: null, revokedAt: null, expiresAt: { gt: now } };
  }
}

function pagination(query: PageQuery, total: number): Pagination {
  return {
    page: query.page,
    pageSize: query.pageSize,
    total,
    totalPages: Math.ceil(total / query.pageSize),
  };
}

function hierarchyDenied(): AppError {
  return permissionDenied("Your staff level cannot manage this level.", { reason: "HIERARCHY" });
}

function selfDenied(): AppError {
  return permissionDenied("You cannot change your own level, roles or access.", {
    reason: "SELF",
  });
}

function employeeNotFound(): AppError {
  return new AppError("NOT_FOUND", "Employee not found.");
}

function invalidInvitation(): AppError {
  return new AppError("AUTH_OTP_INVALID", "This invitation is not valid. Ask for a new one.");
}

function expiredInvitation(): AppError {
  return new AppError("AUTH_OTP_EXPIRED", "This invitation has expired. Ask for a new one.");
}

function roleIdsIssue(message: string, code: string, roleIds: string[]): AppError {
  return new AppError("VALIDATION_ERROR", "Request validation failed.", {
    details: { issues: [{ path: "roleIds", code, message }], roleIds },
  });
}

interface AssignableRole {
  id: string;
  name: string;
  permissionCodes: string[];
}

/** Loads roles to assign: they must exist and be custom (not system) roles. */
async function loadAssignableRoles(tx: Db, roleIds: readonly string[]): Promise<AssignableRole[]> {
  const unique = [...new Set(roleIds)];
  if (unique.length === 0) {
    return [];
  }
  const roles = await tx.role.findMany({
    where: { id: { in: unique } },
    select: {
      id: true,
      name: true,
      isSystemRole: true,
      permissions: { select: { permission: { select: { code: true } } } },
    },
  });
  const found = new Set(roles.map((role) => role.id));
  const missing = unique.filter((id) => !found.has(id));
  if (missing.length > 0) {
    throw roleIdsIssue("Unknown role.", "role_not_found", missing);
  }
  const system = roles.filter((role) => role.isSystemRole).map((role) => role.id);
  if (system.length > 0) {
    throw roleIdsIssue("System roles cannot be assigned.", "role_system", system);
  }
  return roles.map((role) => ({
    id: role.id,
    name: role.name,
    permissionCodes: role.permissions.map((p) => p.permission.code),
  }));
}

/** A Manager may only give or take away roles within their own permissions. */
function assertRolesInScope(
  actor: Pick<StaffActor, "level" | "permissions">,
  roles: readonly AssignableRole[],
): void {
  const outside = roles.filter((role) => !canAssignRole(actor, role.permissionCodes));
  if (outside.length > 0) {
    throw permissionDenied("You cannot assign roles with permissions you do not hold.", {
      reason: "ROLE_OUTSIDE_SCOPE",
      roleIds: outside.map((role) => role.id),
    });
  }
}

async function lockEmail(tx: Db, email: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`employee-email:${emailDigest(email)}`}))`;
}

async function employeeAccountExists(tx: Db, email: string): Promise<boolean> {
  const account = await tx.account.findFirst({
    where: { accountType: "EMPLOYEE", email },
    select: { id: true },
  });
  return account !== null;
}

export function createEmployeeManagementService(deps: EmployeeManagementDeps) {
  const { db, clock, hasher } = deps;
  const emailSender = deps.email ?? getEmailSender();
  const dashboardUrl = deps.dashboardUrl ?? (() => getEnv().DASHBOARD_URL);

  async function roleRefs(ids: readonly string[]): Promise<Map<string, RoleRef>> {
    if (ids.length === 0) {
      return new Map();
    }
    const roles = await db.role.findMany({
      where: { id: { in: [...ids] } },
      select: { id: true, name: true },
    });
    return new Map(roles.map((role) => [role.id, role]));
  }

  async function toInvitationViews(rows: InvitationRow[], now: Date): Promise<InvitationView[]> {
    const refs = await roleRefs([...new Set(rows.flatMap(roleIdsOf))]);
    return rows.map((row) => ({
      id: row.id,
      email: row.email,
      displayName: row.displayName,
      department: row.department,
      level: row.employeeLevel,
      roles: roleIdsOf(row)
        .map((id) => refs.get(id))
        .filter((ref): ref is RoleRef => ref !== undefined),
      status: invitationStatus(row, now),
      invitedBy: { id: row.invitedBy.id, displayName: row.invitedBy.displayName },
      expiresAt: row.expiresAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
      acceptedAt: row.acceptedAt?.toISOString() ?? null,
      revokedAt: row.revokedAt?.toISOString() ?? null,
    }));
  }

  async function listEmployees(
    query: PageQuery & { status?: EmployeeStatus; level?: EmployeeLevel; search?: string },
  ): Promise<Page<EmployeeListView>> {
    const where: Prisma.EmployeeWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.level ? { employeeLevel: query.level } : {}),
      ...(query.search
        ? {
            OR: [
              { displayName: { contains: query.search, mode: "insensitive" } },
              { account: { email: { contains: query.search, mode: "insensitive" } } },
            ],
          }
        : {}),
    };
    const [total, rows] = await Promise.all([
      db.employee.count({ where }),
      db.employee.findMany({
        where,
        include: employeeInclude,
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return { items: rows.map(toEmployeeView), pagination: pagination(query, total) };
  }

  async function listInvitations(
    query: PageQuery & { status?: InvitationStatus },
  ): Promise<Page<InvitationView>> {
    const now = clock.now();
    const where = query.status ? statusWhere(query.status, now) : {};
    const [total, rows] = await Promise.all([
      db.employeeInvitation.count({ where }),
      db.employeeInvitation.findMany({
        where,
        include: invitationInclude,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return { items: await toInvitationViews(rows, now), pagination: pagination(query, total) };
  }

  /**
   * Invites an employee by work email (Q64). The inviter must be allowed to
   * manage the level (Q65) and, for a Manager, to grant every chosen role.
   * The email is sent after the invitation is committed.
   */
  async function invite(
    actor: StaffActor,
    input: {
      email: string;
      displayName: string;
      department?: string | null;
      level: EmployeeLevel;
      roleIds: string[];
    },
    meta: RequestMeta,
  ): Promise<{ invitation: InvitationView; emailSent: boolean }> {
    if (!canManageLevel(actor.level, input.level)) {
      throw hierarchyDenied();
    }
    const now = clock.now();
    const token = generateToken("invite");
    const expiresAt = new Date(now.getTime() + EMPLOYEE_MANAGEMENT_POLICY.invitationTtlMs);
    const row = await runInTransaction(
      async (tx) => {
        await lockEmail(tx, input.email);
        if (await employeeAccountExists(tx, input.email)) {
          throw new AppError("CONFLICT", "This email already belongs to an employee.", {
            details: { reason: "EMPLOYEE_EXISTS" },
          });
        }
        const pending = await tx.employeeInvitation.findFirst({
          where: { email: input.email, ...statusWhere("PENDING", now) },
          select: { id: true },
        });
        if (pending) {
          throw new AppError(
            "CONFLICT",
            "This email already has a pending invitation. Revoke it first.",
            { details: { reason: "INVITATION_PENDING", invitationId: pending.id } },
          );
        }
        const roles = await loadAssignableRoles(tx, input.roleIds);
        assertRolesInScope(actor, roles);
        return tx.employeeInvitation.create({
          data: {
            email: input.email,
            displayName: input.displayName,
            department: input.department ?? null,
            employeeLevel: input.level,
            roleIdsJson: roles.map((role) => role.id),
            invitedByEmployeeId: actor.employeeId,
            tokenHash: hashToken(token),
            expiresAt,
            createdAt: now,
          },
          include: invitationInclude,
        });
      },
      {},
      db,
    );

    let emailSent = true;
    try {
      await emailSender.send(
        invitationEmail({
          to: row.email,
          displayName: row.displayName,
          link: invitationLink(dashboardUrl(), token),
          expiresAt,
        }),
      );
    } catch (error) {
      emailSent = false;
      meta.logger.error("employee invitation email could not be sent", {
        invitationId: row.id,
        err: error,
      });
    }
    meta.logger.info("employee invited", {
      invitationId: row.id,
      actorEmployeeId: actor.employeeId,
      level: row.employeeLevel,
      roleIds: roleIdsOf(row),
    });
    const [view] = await toInvitationViews([row], now);
    return { invitation: view, emailSent };
  }

  async function revokeInvitation(
    actor: StaffActor,
    invitationId: string,
    logger: Logger,
  ): Promise<InvitationView> {
    const now = clock.now();
    const row = await runInTransaction(
      async (tx) => {
        const invitation = await tx.employeeInvitation.findUnique({
          where: { id: invitationId },
        });
        if (!invitation) {
          throw new AppError("NOT_FOUND", "Invitation not found.");
        }
        if (!canManageLevel(actor.level, invitation.employeeLevel)) {
          throw hierarchyDenied();
        }
        const revoked = await tx.employeeInvitation.updateMany({
          where: { id: invitationId, ...statusWhere("PENDING", now) },
          data: { revokedAt: now, revokedByEmployeeId: actor.employeeId },
        });
        if (revoked.count === 0) {
          throw new AppError("CONFLICT", "This invitation is no longer pending.", {
            details: {
              reason: "INVITATION_NOT_PENDING",
              status: invitationStatus(invitation, now),
            },
          });
        }
        return tx.employeeInvitation.findUniqueOrThrow({
          where: { id: invitationId },
          include: invitationInclude,
        });
      },
      {},
      db,
    );
    logger.info("employee invitation revoked", {
      invitationId,
      actorEmployeeId: actor.employeeId,
    });
    const [view] = await toInvitationViews([row], now);
    return view;
  }

  /**
   * Edits an employee: name and department, level, and roles (API §25).
   * Anyone with EMPLOYEE_MANAGE may edit their own name and department, but
   * never their own level or roles.
   */
  async function updateEmployee(
    actor: StaffActor,
    employeeId: string,
    input: {
      displayName?: string;
      department?: string | null;
      level?: EmployeeLevel;
      roleIds?: string[];
    },
    logger: Logger,
  ): Promise<EmployeeListView> {
    const now = clock.now();
    const { row, change } = await runInTransaction(
      async (tx) => {
        const target = await tx.employee.findUnique({
          where: { id: employeeId },
          include: {
            roles: {
              select: {
                role: {
                  select: {
                    id: true,
                    name: true,
                    permissions: { select: { permission: { select: { code: true } } } },
                  },
                },
              },
            },
          },
        });
        if (!target) {
          throw employeeNotFound();
        }
        const self = target.id === actor.employeeId;
        const levelChange = input.level !== undefined && input.level !== target.employeeLevel;

        const current = new Map(target.roles.map((r) => [r.role.id, r.role]));
        const desired = input.roleIds ? new Set(input.roleIds) : null;
        const addedIds = desired ? [...desired].filter((id) => !current.has(id)) : [];
        const removedIds = desired ? [...current.keys()].filter((id) => !desired.has(id)) : [];
        const rolesChange = addedIds.length > 0 || removedIds.length > 0;

        if (self) {
          if (levelChange || rolesChange) {
            throw selfDenied();
          }
        } else {
          if (!canManageLevel(actor.level, target.employeeLevel)) {
            throw hierarchyDenied();
          }
          if (levelChange && !canManageLevel(actor.level, input.level as EmployeeLevel)) {
            throw hierarchyDenied();
          }
        }

        const added = await loadAssignableRoles(tx, addedIds);
        const removed: AssignableRole[] = removedIds.map((id) => {
          const role = current.get(id) as (typeof target.roles)[number]["role"];
          return {
            id: role.id,
            name: role.name,
            permissionCodes: role.permissions.map((p) => p.permission.code),
          };
        });
        assertRolesInScope(actor, [...added, ...removed]);

        if (removedIds.length > 0) {
          await tx.employeeRole.deleteMany({
            where: { employeeId, roleId: { in: removedIds } },
          });
        }
        if (added.length > 0) {
          await tx.employeeRole.createMany({
            data: added.map((role) => ({
              employeeId,
              roleId: role.id,
              assignedByEmployeeId: actor.employeeId,
              assignedAt: now,
            })),
          });
        }
        const updated = await tx.employee.update({
          where: { id: employeeId },
          data: {
            ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
            ...(input.department !== undefined ? { department: input.department } : {}),
            ...(levelChange ? { employeeLevel: input.level } : {}),
            updatedAt: now,
          },
          include: employeeInclude,
        });
        return {
          row: updated,
          change: {
            levelBefore: target.employeeLevel,
            levelAfter: updated.employeeLevel,
            rolesAdded: addedIds,
            rolesRemoved: removedIds,
          },
        };
      },
      {},
      db,
    );
    logger.info("employee updated", {
      employeeId,
      actorEmployeeId: actor.employeeId,
      ...change,
    });
    return toEmployeeView(row);
  }

  /**
   * Removes an employee's access without deleting history (Q64, Q69): the
   * employee is marked DEACTIVATED, every session is revoked and every trusted
   * device forgotten. Deactivating an already deactivated employee changes
   * nothing.
   */
  async function deactivateEmployee(
    actor: StaffActor,
    employeeId: string,
    logger: Logger,
  ): Promise<EmployeeListView> {
    const now = clock.now();
    const { row, revokedSessions, changed } = await runInTransaction(
      async (tx) => {
        const target = await tx.employee.findUnique({ where: { id: employeeId } });
        if (!target) {
          throw employeeNotFound();
        }
        if (target.id === actor.employeeId) {
          throw selfDenied();
        }
        if (!canManageLevel(actor.level, target.employeeLevel)) {
          throw hierarchyDenied();
        }
        if (target.status === "DEACTIVATED") {
          const unchanged = await tx.employee.findUniqueOrThrow({
            where: { id: employeeId },
            include: employeeInclude,
          });
          return { row: unchanged, revokedSessions: 0, changed: false };
        }
        const updated = await tx.employee.update({
          where: { id: employeeId },
          data: { status: "DEACTIVATED", deactivatedAt: now, updatedAt: now },
          include: employeeInclude,
        });
        const revoked = await revokeAccountSessions(tx, target.accountId, "DEACTIVATED", now);
        await tx.employeeTrustedDevice.updateMany({
          where: { accountId: target.accountId, revokedAt: null },
          data: { revokedAt: now },
        });
        return { row: updated, revokedSessions: revoked, changed: true };
      },
      {},
      db,
    );
    if (changed) {
      logger.info("employee deactivated; sessions and trusted devices revoked", {
        employeeId,
        actorEmployeeId: actor.employeeId,
        revokedSessions,
      });
    }
    return toEmployeeView(row);
  }

  /**
   * Accepts an invitation (`POST /employee-auth/accept-invitation`, Q64):
   * creates the employee account with the password chosen by the invitee and
   * the level and roles chosen by the inviter. The inviter's authority is
   * checked again: the invitation stops working if the inviter has been
   * deactivated or can no longer grant what it offers. The invitee then
   * signs in normally (email code on the new device, R28).
   */
  async function acceptInvitation(
    input: { invitationToken: string; password: string },
    meta: RequestMeta,
  ) {
    const now = clock.now();
    const ipKey = `employee-invitation:ip:${meta.ip ?? "unknown"}`;
    const blockedUntil = await getBlockedUntil(db, ipKey, now);
    if (blockedUntil) {
      throw new AppError("AUTH_RATE_LIMITED", "Too many attempts. Try again later.", {
        details: { retryAfterSeconds: secondsUntil(blockedUntil, now) },
      });
    }
    const fail = async (error: AppError): Promise<never> => {
      await recordHit(db, ipKey, OTP_VERIFY_IP_LIMIT, now);
      meta.logger.warn("employee invitation rejected", { reason: error.code });
      throw error;
    };

    if (!isWellFormedToken("invite", input.invitationToken)) {
      return fail(invalidInvitation());
    }
    const tokenHash = hashToken(input.invitationToken);
    const invitation = await db.employeeInvitation.findUnique({ where: { tokenHash } });
    if (!invitation || invitation.acceptedAt !== null || invitation.revokedAt !== null) {
      return fail(invalidInvitation());
    }
    if (invitation.expiresAt <= now) {
      return fail(expiredInvitation());
    }

    const passwordHash = await hasher.hash(input.password);
    let result;
    try {
      result = await runInTransaction(
        async (tx) => {
          await lockEmail(tx, invitation.email);
          const claimed = await tx.employeeInvitation.updateMany({
            where: { id: invitation.id, acceptedAt: null, revokedAt: null, expiresAt: { gt: now } },
            data: { acceptedAt: now },
          });
          if (claimed.count === 0) {
            throw invalidInvitation();
          }
          if (await employeeAccountExists(tx, invitation.email)) {
            throw invalidInvitation();
          }

          // The inviter must still be able to make this invitation.
          const inviter = await tx.employee.findUnique({
            where: { id: invitation.invitedByEmployeeId },
            include: { account: { select: { status: true } } },
          });
          if (!inviter || inviter.status !== "ACTIVE" || inviter.account.status !== "ACTIVE") {
            throw invalidInvitation();
          }
          const inviterPermissions = await effectivePermissions(tx, inviter);
          const inviterActor = { level: inviter.employeeLevel, permissions: inviterPermissions };
          if (
            !inviterPermissions.has("EMPLOYEE_MANAGE") ||
            !canManageLevel(inviter.employeeLevel, invitation.employeeLevel)
          ) {
            throw invalidInvitation();
          }
          let roles: AssignableRole[];
          try {
            roles = await loadAssignableRoles(tx, roleIdsOf(invitation));
            assertRolesInScope(inviterActor, roles);
          } catch {
            throw invalidInvitation();
          }

          const account = await tx.account.create({
            data: {
              accountType: "EMPLOYEE",
              email: invitation.email,
              emailVerifiedAt: now,
              passwordHash,
              passwordChangedAt: now,
              status: "ACTIVE",
              createdAt: now,
              updatedAt: now,
            },
          });
          const employee = await tx.employee.create({
            data: {
              accountId: account.id,
              displayName: invitation.displayName,
              department: invitation.department,
              employeeLevel: invitation.employeeLevel,
              createdByEmployeeId: inviter.id,
              createdAt: now,
              updatedAt: now,
            },
          });
          if (roles.length > 0) {
            await tx.employeeRole.createMany({
              data: roles.map((role) => ({
                employeeId: employee.id,
                roleId: role.id,
                assignedByEmployeeId: inviter.id,
                assignedAt: now,
              })),
            });
          }
          await tx.employeeInvitation.update({
            where: { id: invitation.id },
            data: { acceptedEmployeeId: employee.id },
          });
          return { account, employee };
        },
        {},
        db,
      );
    } catch (error) {
      if (error instanceof AppError && error.code === "AUTH_OTP_INVALID") {
        return fail(error);
      }
      throw error;
    }

    meta.logger.info("employee invitation accepted", {
      invitationId: invitation.id,
      accountId: result.account.id,
      employeeId: result.employee.id,
    });
    return {
      account: {
        id: result.account.id,
        email: result.account.email,
        status: result.account.status,
      },
      employee: {
        id: result.employee.id,
        displayName: result.employee.displayName,
        level: result.employee.employeeLevel,
        department: result.employee.department,
      },
    };
  }

  return {
    listEmployees,
    listInvitations,
    invite,
    revokeInvitation,
    updateEmployee,
    deactivateEmployee,
    acceptInvitation,
  };
}

export type EmployeeManagementService = ReturnType<typeof createEmployeeManagementService>;

let defaultService: EmployeeManagementService | undefined;

export function getEmployeeManagementService(): EmployeeManagementService {
  defaultService ??= createEmployeeManagementService({
    db: getDb(),
    clock: systemClock,
    hasher: createScryptHasher(),
  });
  return defaultService;
}
