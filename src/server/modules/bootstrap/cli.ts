import { z } from "zod";
import { BootstrapError, type OwnerInput } from "@/server/modules/bootstrap/bootstrap";

/**
 * Command-line settings of the bootstrap and the development seed
 * (ADR-0017). They are read only by `prisma/seed.ts` and
 * `prisma/seed-dev.ts`, never by the web server, so the Owner password is
 * not part of the server configuration (src/server/config/env.ts).
 * Documented in .env.example.
 */

const optional = z
  .string()
  .optional()
  .transform((value) => (value === undefined || value.trim() === "" ? undefined : value));

const bootstrapEnvSchema = z.object({
  BOOTSTRAP_OWNER_EMAIL: optional,
  BOOTSTRAP_OWNER_PASSWORD: optional,
  BOOTSTRAP_OWNER_NAME: optional,
});

/**
 * The first Owner's details, or null when neither email nor password is
 * set. Setting only one of them is a mistake and is reported.
 */
export function ownerFromEnv(source: Record<string, string | undefined>): OwnerInput | null {
  const env = bootstrapEnvSchema.parse(source);
  const email = env.BOOTSTRAP_OWNER_EMAIL;
  const password = env.BOOTSTRAP_OWNER_PASSWORD;
  if (email === undefined && password === undefined) {
    return null;
  }
  if (email === undefined || password === undefined) {
    throw new BootstrapError(
      "Set both BOOTSTRAP_OWNER_EMAIL and BOOTSTRAP_OWNER_PASSWORD, or neither.",
    );
  }
  return { email, password, displayName: env.BOOTSTRAP_OWNER_NAME?.trim() };
}

/** DEV_SEED_PASSWORD: the password of every sample staff account. */
export function devSeedPasswordFromEnv(source: Record<string, string | undefined>): string {
  const password = optional.parse(source.DEV_SEED_PASSWORD);
  if (password === undefined) {
    throw new BootstrapError("Set DEV_SEED_PASSWORD (at least 12 characters) in .env first.");
  }
  return password;
}
