import { getEnv } from "@/server/config/env";
import { AppError } from "@/server/errors/app-error";
import {
  getAuthService,
  type AuthService,
  type CustomerPrincipal,
} from "@/server/modules/auth/auth-service";
import {
  assertAllowedOrigin,
  getAccessCredential,
  type CredentialSource,
} from "@/server/modules/auth/transport";

export interface AuthenticatedCustomer extends CustomerPrincipal {
  credentialSource: CredentialSource;
}

/**
 * Session validation for customer endpoints (API contract §6.1):
 * - no token, or an invalid/expired/revoked one → `UNAUTHENTICATED` (401);
 * - an employee session, or a suspended/deactivated account → `FORBIDDEN` (403);
 * - a PENDING_VERIFICATION account → `FORBIDDEN` unless `allowPending`
 *   (only the auth/session endpoints and TASK-008 verification allow it).
 *
 * Cookie-authenticated state-changing requests must pass the Origin/Referer
 * CSRF check (ADR-0013).
 */
export async function requireCustomer(
  request: Request,
  options: { allowPending?: boolean; service?: AuthService } = {},
): Promise<AuthenticatedCustomer> {
  const credential = getAccessCredential(request);
  if (!credential) {
    throw new AppError("UNAUTHENTICATED", "Authentication required. Sign in again.");
  }
  if (credential.source === "cookie") {
    assertAllowedOrigin(request, getEnv().AUTH_ALLOWED_ORIGINS, true);
  }
  const service = options.service ?? getAuthService();
  const principal = await service.authenticate(credential.token, {
    allowPending: options.allowPending,
  });
  return { ...principal, credentialSource: credential.source };
}
