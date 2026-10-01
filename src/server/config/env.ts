import { isIP } from "node:net";
import { z } from "zod";
import { LOG_LEVELS } from "@/server/logging/logger";

/** Comma-separated list; blank entries are ignored. */
function commaList(item: z.ZodType<string, string>) {
  return z
    .string()
    .default("")
    .transform((value) =>
      value
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry !== ""),
    )
    .pipe(z.array(item));
}

/** An IP address or CIDR block, e.g. `10.0.0.1`, `10.0.0.0/8`, `fd00::/8`. */
const ipOrCidr = z.string().refine(
  (value) => {
    const [address, prefix, ...rest] = value.split("/");
    const version = isIP(address);
    if (version === 0 || rest.length > 0) {
      return false;
    }
    if (prefix === undefined) {
      return true;
    }
    const bits = Number(prefix);
    return /^\d{1,3}$/.test(prefix) && bits <= (version === 4 ? 32 : 128);
  },
  { message: "must be a comma-separated list of IP addresses or CIDR blocks" },
);

/** A bare origin such as `https://beautyfits.example` (no path). */
const origin = z.string().refine(
  (value) => {
    try {
      return new URL(value).origin === value;
    } catch {
      return false;
    }
  },
  { message: "must be a comma-separated list of origins like https://example.com" },
);

/**
 * Server configuration schema (ADR-0007).
 *
 * Only variables that are actually used belong here; each one must also be
 * documented in .env.example. Never import this module from client code.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z
    .string()
    .min(1)
    .refine((value) => /^postgres(ql)?:\/\//.test(value), {
      message: "must be a postgres:// or postgresql:// connection string",
    }),
  LOG_LEVEL: z.enum(LOG_LEVELS).default("info"),
  /**
   * Reverse proxies whose X-Forwarded-For / X-Real-IP headers are trusted
   * (ADR-0013). Empty (default): forwarding headers are ignored and the
   * direct connection address is used.
   */
  TRUSTED_PROXIES: commaList(ipOrCidr),
  /**
   * Browser origins allowed to make cookie-authenticated state-changing
   * requests (CSRF check, ADR-0013). Empty (default): same origin only.
   */
  AUTH_ALLOWED_ORIGINS: commaList(origin),
  /**
   * Local mailbox directory: outgoing emails are written there as .eml files
   * (ADR-0014). The only email transport until a provider is chosen.
   */
  MAIL_DIR: z.string().min(1).default(".mail"),
});

export type Env = z.infer<typeof envSchema>;

export class EnvValidationError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid server configuration:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
    this.name = "EnvValidationError";
  }
}

/**
 * Validates a raw environment object. Error messages name the offending
 * variable but never include its value, so secrets cannot leak into logs.
 */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    throw new EnvValidationError(
      result.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`),
    );
  }
  return result.data;
}

let cached: Env | undefined;

/**
 * Lazily validated configuration. Validation happens on first use (at
 * request time), so `next build` does not require runtime secrets.
 */
export function getEnv(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}
