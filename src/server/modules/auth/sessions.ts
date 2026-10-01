import type { AuthDomain, SessionRevokeReason } from "@/generated/prisma/client";
import type { Db } from "@/server/db/transaction";
import { AUTH_POLICY } from "@/server/modules/auth/policy";
import { generateToken, hashToken } from "@/server/modules/auth/tokens";
import type { IssuedTokens } from "@/server/modules/auth/transport";

/**
 * Session and token storage (ADR-0008, ADR-0013).
 *
 * An `auth_sessions` row is one login on one device (a refresh-token family)
 * with an absolute expiry. Each refresh supersedes the current token pair and
 * issues a new one in `auth_session_tokens`. Revoking the session invalidates
 * every pair at once.
 */

export interface SessionMeta {
  ip: string | null;
  userAgent: string | null;
}

const USER_AGENT_MAX_LENGTH = 512;

/** Issues a new access/refresh pair for a session. The access token never outlives the session. */
export async function issueTokenPair(
  db: Db,
  session: { id: string; expiresAt: Date },
  now: Date,
): Promise<IssuedTokens> {
  const accessToken = generateToken("access");
  const refreshToken = generateToken("refresh");
  const accessTokenExpiresAt = new Date(
    Math.min(now.getTime() + AUTH_POLICY.accessTokenTtlMs, session.expiresAt.getTime()),
  );
  await db.authSessionToken.create({
    data: {
      sessionId: session.id,
      accessTokenHash: hashToken(accessToken),
      refreshTokenHash: hashToken(refreshToken),
      accessExpiresAt: accessTokenExpiresAt,
      createdAt: now,
    },
  });
  return {
    accessToken,
    accessTokenExpiresAt,
    refreshToken,
    refreshTokenExpiresAt: session.expiresAt,
  };
}

export async function createSession(
  db: Db,
  input: { accountId: string; domain: AuthDomain; ttlMs: number },
  meta: SessionMeta,
  now: Date,
): Promise<{ sessionId: string; expiresAt: Date; tokens: IssuedTokens }> {
  const session = await db.authSession.create({
    data: {
      accountId: input.accountId,
      domain: input.domain,
      createdAt: now,
      lastUsedAt: now,
      expiresAt: new Date(now.getTime() + input.ttlMs),
      ipAddress: meta.ip,
      userAgent: meta.userAgent?.slice(0, USER_AGENT_MAX_LENGTH) ?? null,
    },
  });
  const tokens = await issueTokenPair(db, session, now);
  return { sessionId: session.id, expiresAt: session.expiresAt, tokens };
}

/** Revokes one session. Returns false when it was already revoked. */
export async function revokeSession(
  db: Db,
  sessionId: string,
  reason: SessionRevokeReason,
  now: Date,
): Promise<boolean> {
  const result = await db.authSession.updateMany({
    where: { id: sessionId, revokedAt: null },
    data: { revokedAt: now, revokeReason: reason },
  });
  return result.count > 0;
}

/**
 * Revokes every active session of an account, optionally keeping one
 * (password change keeps the current session, Business Spec R23).
 * Password reset (TASK-008) calls this with `PASSWORD_RESET` and no exception.
 */
export async function revokeAccountSessions(
  db: Db,
  accountId: string,
  reason: SessionRevokeReason,
  now: Date,
  options: { exceptSessionId?: string } = {},
): Promise<number> {
  const result = await db.authSession.updateMany({
    where: {
      accountId,
      revokedAt: null,
      ...(options.exceptSessionId ? { id: { not: options.exceptSessionId } } : {}),
    },
    data: { revokedAt: now, revokeReason: reason },
  });
  return result.count;
}
