import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * End-to-end suite settings (TASK-063, ADR-0071), shared by the Playwright
 * config, the global setup and the specs. Everything here is a throwaway
 * test value: a dedicated `*_test` database, local mail/WhatsApp/media
 * folders under the OS temp directory, and staff credentials that exist only
 * in that database.
 */

export const E2E_PORT = Number.parseInt(process.env.E2E_PORT ?? "3163", 10);
export const BASE_URL = `http://localhost:${E2E_PORT}`;

/** Dropped and recreated on every run; the name must end in `_test`. */
export const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ??
  "postgresql://beautyfits:beautyfits@localhost:5432/beautyfits_e2e_test?schema=public";

const ROOT = join(tmpdir(), `beautyfits-e2e-${E2E_PORT}`);
export const MAIL_DIR = join(ROOT, "mail");
export const WHATSAPP_DIR = join(ROOT, "whatsapp");
export const MEDIA_DIR = join(ROOT, "media");

/** The Owner created by the bootstrap seed in the E2E database only. */
export const OWNER = {
  email: "e2e.owner@beautyfits.example",
  password: "e2e-owner-passphrase-only-for-tests",
};

/** The carrier the setup adds (the dev seeds add none). */
export const CARRIER = { code: "E2E", name: "E2E Express" };

/** Environment of the app server and the seed script. */
export function serverEnv(): Record<string, string> {
  return {
    NODE_ENV: "production",
    PORT: String(E2E_PORT),
    HOSTNAME: "localhost",
    DATABASE_URL: E2E_DATABASE_URL,
    LOG_LEVEL: "warn",
    MAIL_DIR,
    WHATSAPP_DIR,
    MEDIA_DIR,
    WEBSITE_URL: BASE_URL,
    DASHBOARD_URL: BASE_URL,
    AUTH_ALLOWED_ORIGINS: BASE_URL,
    TRUSTED_PROXIES: "",
    NEXT_TELEMETRY_DISABLED: "1",
  };
}
