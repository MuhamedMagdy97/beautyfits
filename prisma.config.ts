import { existsSync } from "node:fs";
import { defineConfig } from "prisma/config";

// Prisma 7 does not load .env files. Load the local .env (if any) with the
// Node.js built-in loader; real environments inject variables directly.
if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    // Production bootstrap (TASK-004, ADR-0017): `npm run db:seed`.
    seed: "tsx prisma/seed.ts",
  },
  // Optional so `prisma generate` works on a clean checkout without a
  // database. Migration commands fail fast when DATABASE_URL is missing.
  datasource: {
    url: process.env.DATABASE_URL,
  },
});
