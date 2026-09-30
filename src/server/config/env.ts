import { z } from "zod";
import { LOG_LEVELS } from "@/server/logging/logger";

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
