import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Integration tests (ADR-0010): real PostgreSQL, run with `npm run test:integration`.
// Load the local .env (if any) so TEST_DATABASE_URL is available; variables
// already set in the environment (for example in CI) take precedence.
if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.int.test.ts"],
    globalSetup: ["./src/test/integration/global-setup.ts"],
    // One database: run test files one after another.
    fileParallelism: false,
    restoreMocks: true,
    testTimeout: 20_000,
    hookTimeout: 120_000,
    env: {
      LOG_LEVEL: "error",
      // The application code under test connects to the test database.
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? "",
      // Outgoing test emails go to a throwaway mailbox, never the local .mail/.
      MAIL_DIR: join(tmpdir(), `beautyfits-test-mail-${process.pid}`),
      // Outgoing test WhatsApp messages go to a throwaway directory, never .whatsapp/.
      WHATSAPP_DIR: join(tmpdir(), `beautyfits-test-whatsapp-${process.pid}`),
      // Uploaded test files go to a throwaway directory, never the local .media/.
      MEDIA_DIR: join(tmpdir(), `beautyfits-test-media-${process.pid}`),
    },
  },
});
