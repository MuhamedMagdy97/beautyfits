import type { RateLimitPolicy } from "@/server/rate-limit/rate-limit";
import { MS_PER_DAY, MS_PER_HOUR, MS_PER_MINUTE, MS_PER_SECOND } from "@/server/time/time";

/**
 * Customer authentication policy (TASK-007). Business values cite their rule;
 * the others are technical parameters recorded in ADR-0013.
 */
export const AUTH_POLICY = {
  /** Password length in Unicode code points after NFKC (Q156; the maximum is a DoS guard). */
  passwordMinLength: 12,
  passwordMaxLength: 256,
  /** Registration full name, trimmed (owner answer, TASK-007). */
  fullNameMaxLength: 100,
  /** A PENDING_VERIFICATION account expires 24 hours after creation (owner answer, TASK-007). */
  pendingAccountTtlMs: 24 * MS_PER_HOUR,
  /** Absolute customer session lifetime from login (Q162; absolute per owner answer). */
  customerSessionTtlMs: 30 * MS_PER_DAY,
  /** Access token lifetime (ADR-0013). */
  accessTokenTtlMs: 15 * MS_PER_MINUTE,
  /**
   * A superseded refresh token presented within this time after rotation is
   * rejected without revoking the session (concurrent refresh from two tabs).
   */
  refreshReuseGraceMs: 10 * MS_PER_SECOND,
  /** `auth_sessions.last_used_at` is written at most this often. */
  lastUsedWriteIntervalMs: MS_PER_MINUTE,
} as const;

/** R24: 5 consecutive failed password attempts block the account's login for 15 minutes. */
export const LOGIN_ACCOUNT_LIMIT: RateLimitPolicy = {
  limit: 5,
  windowMs: null,
  blockMs: 15 * MS_PER_MINUTE,
};

/** R24 per-IP limit (ADR-0013): 30 failed logins in 15 minutes block the IP for 15 minutes. */
export const LOGIN_IP_LIMIT: RateLimitPolicy = {
  limit: 30,
  windowMs: 15 * MS_PER_MINUTE,
  blockMs: 15 * MS_PER_MINUTE,
};

/** Registrations per IP (ADR-0013): 10 per hour. */
export const REGISTER_IP_LIMIT: RateLimitPolicy = {
  limit: 10,
  windowMs: MS_PER_HOUR,
  blockMs: MS_PER_HOUR,
};
