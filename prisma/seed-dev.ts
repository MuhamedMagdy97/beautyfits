// Development sample data (TASK-004, ADR-0017): `npm run db:seed:dev`.
// Runs the production bootstrap, then adds sample staff. Never in production.
import { existsSync } from "node:fs";
import { getDb } from "@/server/db/client";
import { createScryptHasher } from "@/server/modules/auth/password-hash";
import { BootstrapError, runBootstrap } from "@/server/modules/bootstrap/bootstrap";
import { devSeedPasswordFromEnv, ownerFromEnv } from "@/server/modules/bootstrap/cli";
import { runDevSeed, SAMPLE_STAFF } from "@/server/modules/bootstrap/dev-seed";
import { systemClock } from "@/server/time/time";

if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

// The package is CommonJS for tsx, so no top-level await.
async function main(): Promise<void> {
  const db = getDb();
  try {
    const deps = { db, clock: systemClock, hasher: createScryptHasher() };
    const password = devSeedPasswordFromEnv(process.env);
    await runBootstrap(deps, { owner: ownerFromEnv(process.env) });
    const { staffCreated } = await runDevSeed(deps, {
      password,
      nodeEnv: process.env.NODE_ENV ?? "development",
    });
    console.log(`Sample staff added: ${staffCreated.length}`);
    for (const sample of SAMPLE_STAFF) {
      console.log(`  ${sample.email} (${sample.level}, ${sample.roleName})`);
    }
    console.log("Their password is DEV_SEED_PASSWORD; their login codes go to the .mail folder.");
  } catch (error) {
    console.error(error instanceof BootstrapError ? error.message : error);
    process.exitCode = 1;
  } finally {
    await db.$disconnect();
  }
}

void main();
