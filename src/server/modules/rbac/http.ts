import { AppError } from "@/server/errors/app-error";
import type { AuthorizedEmployee } from "@/server/modules/rbac/authorization";
import type { StaffActor } from "@/server/modules/rbac/employees-service";
import { uuidParam } from "@/server/modules/rbac/schemas";

/** Helpers shared by the /api/v1/admin employee, role and permission routes. */

export function actorOf(employee: AuthorizedEmployee): StaffActor {
  return {
    employeeId: employee.employeeId,
    accountId: employee.accountId,
    level: employee.level,
    permissions: employee.permissions,
  };
}

/** A malformed id cannot name anything: `404 NOT_FOUND`. */
export function pathId(value: string, what: string): string {
  if (!uuidParam.safeParse(value).success) {
    throw new AppError("NOT_FOUND", `${what} not found.`);
  }
  return value;
}
