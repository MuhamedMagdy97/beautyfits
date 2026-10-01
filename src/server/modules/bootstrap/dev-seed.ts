import { runInTransaction } from "@/server/db/transaction";
import { logger as defaultLogger } from "@/server/logging/logger";
import {
  checkPasswordPolicy,
  PASSWORD_PROBLEM_MESSAGES,
} from "@/server/modules/auth/password-policy";
import { BootstrapError, type BootstrapDeps } from "@/server/modules/bootstrap/bootstrap";

/**
 * Development sample data (TASK-004, ADR-0017), kept apart from the
 * production bootstrap: `npm run db:seed:dev`, refused when NODE_ENV is
 * production. It adds a few staff members so roles and permissions can be
 * tried locally. Run the bootstrap (with an Owner) first.
 *
 * Deterministic: fixed emails, names, levels and roles; existing sample
 * accounts are left as they are.
 */

export interface SampleStaff {
  email: string;
  displayName: string;
  level: "MANAGER" | "EMPLOYEE";
  roleName: string;
}

/** `.example` is a reserved domain (RFC 2606): these addresses never reach anyone. */
export const SAMPLE_STAFF: readonly SampleStaff[] = [
  {
    email: "sample.manager@beautyfits.example",
    displayName: "Sample Inventory Manager",
    level: "MANAGER",
    roleName: "Inventory Manager",
  },
  {
    email: "sample.employee@beautyfits.example",
    displayName: "Sample Catalog Editor",
    level: "EMPLOYEE",
    roleName: "Catalog Editor",
  },
];

export async function runDevSeed(
  deps: BootstrapDeps,
  input: { password: string; nodeEnv: string },
): Promise<{ staffCreated: string[] }> {
  const { db, clock, hasher } = deps;
  const log = deps.logger ?? defaultLogger;
  if (input.nodeEnv === "production") {
    throw new BootstrapError("The development seed never runs with NODE_ENV=production.");
  }
  const problem = checkPasswordPolicy(input.password);
  if (problem) {
    throw new BootstrapError(`Invalid DEV_SEED_PASSWORD: ${PASSWORD_PROBLEM_MESSAGES[problem]}`);
  }

  const owner = await db.employee.findFirst({
    where: { employeeLevel: "OWNER" },
    select: { id: true },
  });
  if (!owner) {
    throw new BootstrapError(
      "No Owner exists yet. Run `npm run db:seed` with the Owner details first.",
    );
  }

  const passwordHash = await hasher.hash(input.password);
  const now = clock.now();
  const staffCreated = await runInTransaction(
    async (tx) => {
      const created: string[] = [];
      for (const sample of SAMPLE_STAFF) {
        const exists = await tx.account.findFirst({
          where: { accountType: "EMPLOYEE", email: sample.email },
          select: { id: true },
        });
        if (exists) {
          continue;
        }
        const role = await tx.role.findFirst({
          where: { name: { equals: sample.roleName, mode: "insensitive" } },
          select: { id: true },
        });
        const account = await tx.account.create({
          data: {
            accountType: "EMPLOYEE",
            email: sample.email,
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
            displayName: sample.displayName,
            employeeLevel: sample.level,
            createdByEmployeeId: owner.id,
            createdAt: now,
            updatedAt: now,
          },
        });
        if (role) {
          await tx.employeeRole.create({
            data: {
              employeeId: employee.id,
              roleId: role.id,
              assignedByEmployeeId: owner.id,
              assignedAt: now,
            },
          });
        }
        created.push(sample.email);
      }
      return created;
    },
    {},
    db,
  );
  log.info("dev_seed.completed", { staffCreated: staffCreated.length });
  return { staffCreated };
}
