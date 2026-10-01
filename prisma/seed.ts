// Production bootstrap (TASK-004, ADR-0017): `npm run db:seed`.
// Permissions check, default settings, default roles and the first Owner
// (from BOOTSTRAP_OWNER_EMAIL / BOOTSTRAP_OWNER_PASSWORD). Safe to run again.
import { existsSync } from "node:fs";
import { getDb } from "@/server/db/client";
import { createScryptHasher } from "@/server/modules/auth/password-hash";
import { BootstrapError, runBootstrap } from "@/server/modules/bootstrap/bootstrap";
import { ownerFromEnv } from "@/server/modules/bootstrap/cli";
import { systemClock } from "@/server/time/time";

if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

// The package is CommonJS for tsx, so no top-level await.
async function main(): Promise<void> {
  const db = getDb();
  try {
    const report = await runBootstrap(
      { db, clock: systemClock, hasher: createScryptHasher() },
      { owner: ownerFromEnv(process.env) },
    );
    console.log(`Settings added: ${report.settingsCreated.length}`);
    console.log(`Default roles added: ${report.rolesCreated.join(", ") || "none"}`);
    if (report.owner === "CREATED") {
      console.log("Owner account created. Remove BOOTSTRAP_OWNER_PASSWORD from .env now.");
    } else if (report.owner === "EXISTS") {
      console.log("Owner account already exists; left unchanged.");
    } else {
      console.log(
        "No Owner yet. Set BOOTSTRAP_OWNER_EMAIL and BOOTSTRAP_OWNER_PASSWORD in .env, then run again.",
      );
    }
  } catch (error) {
    console.error(error instanceof BootstrapError ? error.message : error);
    process.exitCode = 1;
  } finally {
    await db.$disconnect();
  }
}

void main();
