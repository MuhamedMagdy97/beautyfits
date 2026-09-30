import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Integration tests need PostgreSQL; they run with `npm run test:integration`.
    exclude: ["src/**/*.int.test.ts", "node_modules/**"],
    restoreMocks: true,
    // Keep the root logger quiet in tests; tests that assert on logs inject their own logger.
    env: { LOG_LEVEL: "error" },
  },
});
