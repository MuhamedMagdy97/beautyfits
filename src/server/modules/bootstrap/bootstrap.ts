import { z } from "zod";
import type { PrismaClient } from "@/generated/prisma/client";
import { runInTransaction } from "@/server/db/transaction";
import { logger as defaultLogger, type Logger } from "@/server/logging/logger";
import { normalizeEmail } from "@/server/modules/auth/identifiers";
import type { PasswordHasher } from "@/server/modules/auth/password-hash";
import {
  checkPasswordPolicy,
  PASSWORD_PROBLEM_MESSAGES,
} from "@/server/modules/auth/password-policy";
import { DEFAULT_ROLES } from "@/server/modules/bootstrap/default-roles";
import { PERMISSION_CODES } from "@/server/modules/rbac/catalog";
import { lockRoleNames } from "@/server/modules/rbac/roles-service";
import { SETTING_DEFINITIONS } from "@/server/modules/settings/settings";
import type { Clock } from "@/server/time/time";

/**
 * Production bootstrap (TASK-004, ADR-0017): makes a fresh database usable
 * without editing it by hand. It is run from the command line
 * (`npm run db:seed`), never through the HTTP API, and is safe to run again:
 *
 * 1. checks that the permission catalog rows exist (inserted by migrations);
 * 2. inserts missing settings with their default (never overwrites a value);
 * 3. creates each missing default role of permission catalog §3, by its
 *    fixed id (never changes a role that exists, so the Owner's edits and
 *    renames survive; skipped when another role already uses the name);
 * 4. creates the first Owner from the given email and password, only while
 *    no Owner exists. An existing Owner is never changed.
 */

export class BootstrapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BootstrapError";
  }
}

export const DEFAULT_OWNER_DISPLAY_NAME = "Owner";

const DISPLAY_NAME_MAX = 100;

export const ownerInputSchema = z.object({
  email: z
    .string()
    .max(254)
    .transform(normalizeEmail)
    .pipe(z.email({ message: "must be a valid email address" })),
  password: z.string().superRefine((password, ctx) => {
    const problem = checkPasswordPolicy(password);
    if (problem) {
      ctx.addIssue({ code: "custom", message: PASSWORD_PROBLEM_MESSAGES[problem] });
    }
  }),
  displayName: z.string().trim().min(1).max(DISPLAY_NAME_MAX).default(DEFAULT_OWNER_DISPLAY_NAME),
});

export type OwnerInput = z.input<typeof ownerInputSchema>;

export interface BootstrapDeps {
  db: PrismaClient;
  clock: Clock;
  hasher: PasswordHasher;
  logger?: Logger;
}

export type OwnerOutcome =
  /** The Owner account was created by this run. */
  | "CREATED"
  /** An Owner already exists; nothing was changed. */
  | "EXISTS"
  /** No Owner exists and no Owner details were given. */
  | "MISSING";

export interface BootstrapReport {
  settingsCreated: string[];
  rolesCreated: string[];
  owner: OwnerOutcome;
}

async function assertPermissionCatalog(db: PrismaClient): Promise<void> {
  const rows = await db.permission.findMany({ select: { code: true } });
  const stored = new Set(rows.map((row) => row.code));
  const missing = PERMISSION_CODES.filter((code) => !stored.has(code));
  if (missing.length > 0) {
    throw new BootstrapError(
      `The permissions table is missing ${missing.length} catalog permission(s). ` +
        "Apply the database migrations first (npm run db:deploy or npm run db:migrate).",
    );
  }
}

async function ensureSettings(deps: BootstrapDeps): Promise<string[]> {
  const { db, clock } = deps;
  const now = clock.now();
  return runInTransaction(
    async (tx) => {
      const existing = await tx.setting.findMany({
        where: { key: { in: SETTING_DEFINITIONS.map((d) => d.key) } },
        select: { key: true },
      });
      const present = new Set(existing.map((row) => row.key));
      const missing = SETTING_DEFINITIONS.filter((d) => !present.has(d.key));
      if (missing.length > 0) {
        await tx.setting.createMany({
          data: missing.map((d) => ({
            key: d.key,
            valueJson: d.defaultValue as never,
            dataType: d.dataType,
            updatedAt: now,
          })),
          skipDuplicates: true,
        });
      }
      return missing.map((d) => d.key);
    },
    {},
    db,
  );
}

async function ensureDefaultRoles(deps: BootstrapDeps): Promise<string[]> {
  const { db, clock } = deps;
  const now = clock.now();
  return runInTransaction(
    async (tx) => {
      await lockRoleNames(tx);
      const permissions = await tx.permission.findMany({ select: { id: true, code: true } });
      const permissionIds = new Map(permissions.map((p) => [p.code, p.id]));
      const created: string[] = [];
      for (const role of DEFAULT_ROLES) {
        const existing = await tx.role.findFirst({
          where: {
            OR: [{ id: role.id }, { name: { equals: role.name, mode: "insensitive" } }],
          },
          select: { id: true },
        });
        if (existing) {
          continue;
        }
        await tx.role.create({
          data: {
            id: role.id,
            name: role.name,
            description: null,
            isSystemRole: false,
            createdByEmployeeId: null,
            createdAt: now,
            updatedAt: now,
            permissions: {
              create: role.permissions.map((code) => ({ permissionId: permissionIds.get(code)! })),
            },
          },
        });
        created.push(role.name);
      }
      return created;
    },
    {},
    db,
  );
}

async function ensureOwner(
  deps: BootstrapDeps,
  owner: z.output<typeof ownerInputSchema> | null,
  passwordHash: string | null,
): Promise<{ outcome: OwnerOutcome; employeeId?: string }> {
  const { db, clock } = deps;
  const now = clock.now();
  return runInTransaction(
    async (tx) => {
      // One bootstrap at a time decides whether the Owner exists.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('bootstrap:owner'))`;
      const existingOwner = await tx.employee.findFirst({
        where: { employeeLevel: "OWNER" },
        select: { id: true },
      });
      if (existingOwner) {
        return { outcome: "EXISTS" as const };
      }
      if (!owner || !passwordHash) {
        return { outcome: "MISSING" as const };
      }
      // A customer account with the same email is fine (R15); another
      // employee account is not.
      const clash = await tx.account.findFirst({
        where: { accountType: "EMPLOYEE", email: owner.email },
        select: { id: true },
      });
      if (clash) {
        throw new BootstrapError(
          "An employee account with the Owner email already exists. Use another email.",
        );
      }
      const account = await tx.account.create({
        data: {
          accountType: "EMPLOYEE",
          email: owner.email,
          // The operator chose this address; the first login still proves it
          // with an email code before the device is trusted (R28).
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
          displayName: owner.displayName,
          department: null,
          employeeLevel: "OWNER",
          // Null marks the first Owner (DB design "v1.2 TASK-011 Amendments").
          createdByEmployeeId: null,
          createdAt: now,
          updatedAt: now,
        },
      });
      return { outcome: "CREATED" as const, employeeId: employee.id };
    },
    {},
    db,
  );
}

/** Parses Owner details; throws a BootstrapError that names the problem. */
export function parseOwnerInput(input: OwnerInput): z.output<typeof ownerInputSchema> {
  const result = ownerInputSchema.safeParse(input);
  if (!result.success) {
    const problems = result.error.issues.map(
      (issue) => `  - Owner ${issue.path.join(".")}: ${issue.message}`,
    );
    throw new BootstrapError(`Invalid Owner details:\n${problems.join("\n")}`);
  }
  return result.data;
}

export async function runBootstrap(
  deps: BootstrapDeps,
  input: { owner?: OwnerInput | null } = {},
): Promise<BootstrapReport> {
  const log = deps.logger ?? defaultLogger;
  // Validate before writing anything, so a bad password changes nothing.
  const owner = input.owner ? parseOwnerInput(input.owner) : null;

  await assertPermissionCatalog(deps.db);
  const settingsCreated = await ensureSettings(deps);
  const rolesCreated = await ensureDefaultRoles(deps);

  // Hash only when an Owner may be created (scrypt is deliberately slow).
  const ownerExists = (await deps.db.employee.count({ where: { employeeLevel: "OWNER" } })) > 0;
  const passwordHash = owner && !ownerExists ? await deps.hasher.hash(owner.password) : null;
  const ownerResult = await ensureOwner(deps, owner, passwordHash);

  // Until audit_logs exists (TASK-013), bootstrap events go to the logger.
  // No emails or passwords are logged.
  log.info("bootstrap.completed", {
    settingsCreated,
    rolesCreated,
    owner: ownerResult.outcome,
    ...(ownerResult.employeeId ? { ownerEmployeeId: ownerResult.employeeId } : {}),
  });
  return { settingsCreated, rolesCreated, owner: ownerResult.outcome };
}
