import { getEnv } from "@/server/config/env";
import { AppError } from "@/server/errors/app-error";
import {
  getEmployeeAuthService,
  type EmployeeAuthService,
  type EmployeePrincipal,
} from "@/server/modules/auth/employee-auth-service";
import {
  assertAllowedOrigin,
  EMPLOYEE_COOKIES,
  getAccessCredential,
  type CredentialSource,
} from "@/server/modules/auth/transport";

export interface AuthenticatedEmployee extends EmployeePrincipal {
  credentialSource: CredentialSource;
}

/**
 * Session validation for employee endpoints (API contract §6.1, TASK-011):
 * - no token, or an invalid/expired/revoked/idle one → `UNAUTHENTICATED` (401);
 * - a customer session, or a deactivated employee → `FORBIDDEN` (403).
 *
 * Reads `Authorization: Bearer` or the employee access cookie (never the
 * customer cookie). Cookie-authenticated state-changing requests must pass
 * the Origin/Referer CSRF check (ADR-0013). Permission checks come with
 * TASK-012.
 */
export async function requireEmployee(
  request: Request,
  options: { service?: EmployeeAuthService } = {},
): Promise<AuthenticatedEmployee> {
  const credential = getAccessCredential(request, EMPLOYEE_COOKIES);
  if (!credential) {
    throw new AppError("UNAUTHENTICATED", "Authentication required. Sign in again.");
  }
  if (credential.source === "cookie") {
    assertAllowedOrigin(request, getEnv().AUTH_ALLOWED_ORIGINS, true);
  }
  const service = options.service ?? getEmployeeAuthService();
  const principal = await service.authenticate(credential.token);
  return { ...principal, credentialSource: credential.source };
}
