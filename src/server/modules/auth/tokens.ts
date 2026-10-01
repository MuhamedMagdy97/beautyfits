import { createHash, randomBytes } from "node:crypto";

/**
 * Opaque session tokens (ADR-0008, ADR-0013): 256 random bits, base64url,
 * with a prefix naming the kind. Only the SHA-256 hash is stored, so a
 * database leak does not yield usable tokens.
 */
export type TokenKind = "access" | "refresh" | "reset" | "login" | "device";

/**
 * `reset`: the single-use password-reset grant (TASK-008, ADR-0014).
 * `login`: the employee login ticket between password and email code;
 * `device`: an employee trusted device (TASK-011, ADR-0015).
 */
const PREFIX: Record<TokenKind, string> = {
  access: "bfa_",
  refresh: "bfr_",
  reset: "bfp_",
  login: "bfl_",
  device: "bfd_",
};
const TOKEN_FORMAT: Record<TokenKind, RegExp> = {
  access: /^bfa_[A-Za-z0-9_-]{43}$/,
  refresh: /^bfr_[A-Za-z0-9_-]{43}$/,
  reset: /^bfp_[A-Za-z0-9_-]{43}$/,
  login: /^bfl_[A-Za-z0-9_-]{43}$/,
  device: /^bfd_[A-Za-z0-9_-]{43}$/,
};

export function generateToken(kind: TokenKind): string {
  return PREFIX[kind] + randomBytes(32).toString("base64url");
}

/** SHA-256 (hex) of a token: the only form that is stored or looked up. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Cheap shape check before any database lookup. */
export function isWellFormedToken(kind: TokenKind, value: string): boolean {
  return TOKEN_FORMAT[kind].test(value);
}
