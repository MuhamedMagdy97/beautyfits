import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AUTH_POLICY } from "@/server/modules/auth/policy";

/**
 * Password policy (Business Spec Q156): at least 12 characters, long
 * passphrases allowed, common/breached passwords rejected, no composition
 * rules.
 *
 * Passwords are NFKC-normalized before they are measured, checked or hashed,
 * so the same passphrase typed on different keyboards matches.
 */
export type PasswordProblem = "password_too_short" | "password_too_long" | "password_common";

export function normalizePassword(password: string): string {
  return password.normalize("NFKC");
}

/**
 * Bundled offline list of common/breached passwords (ADR-0013): SecLists
 * (MIT licence) entries with 12+ characters, NFKC-normalized and lowercased,
 * one per line. Loaded once, on first use.
 */
const COMMON_PASSWORDS_FILE = join(
  process.cwd(),
  "src",
  "server",
  "modules",
  "auth",
  "common-passwords.txt",
);

let commonPasswords: Set<string> | undefined;

function getCommonPasswords(): Set<string> {
  commonPasswords ??= new Set(
    readFileSync(COMMON_PASSWORDS_FILE, "utf8")
      .split(/\r?\n/)
      .filter((line) => line !== ""),
  );
  return commonPasswords;
}

export function isCommonPassword(password: string): boolean {
  return getCommonPasswords().has(normalizePassword(password).toLowerCase());
}

/** The first policy problem with a password, or null when it is acceptable. */
export function checkPasswordPolicy(password: string): PasswordProblem | null {
  const length = [...normalizePassword(password)].length;
  if (length < AUTH_POLICY.passwordMinLength) {
    return "password_too_short";
  }
  if (length > AUTH_POLICY.passwordMaxLength) {
    return "password_too_long";
  }
  if (isCommonPassword(password)) {
    return "password_common";
  }
  return null;
}

export const PASSWORD_PROBLEM_MESSAGES: Record<PasswordProblem, string> = {
  password_too_short: `Password must be at least ${AUTH_POLICY.passwordMinLength} characters.`,
  password_too_long: `Password must be at most ${AUTH_POLICY.passwordMaxLength} characters.`,
  password_common: "This password is too common. Choose a less predictable passphrase.",
};
