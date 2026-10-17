// E2E database setup (TASK-063, ADR-0071), run by e2e/global-setup.ts with tsx:
// drops and recreates the dedicated E2E database from migrations, then seeds
// it with the existing seeds (bootstrap Owner, sample catalog, sample delivery
// areas) and one carrier. Never touches any other database.
import { execSync } from "node:child_process";
import { PrismaPg } from "@prisma/adapter-pg";
import { getDb } from "@/server/db/client";
import { PrismaClient } from "@/generated/prisma/client";
import { logger } from "@/server/logging/logger";
import { createScryptHasher } from "@/server/modules/auth/password-hash";
import { runBootstrap } from "@/server/modules/bootstrap/bootstrap";
import { runDevCatalogSeed } from "@/server/modules/bootstrap/dev-catalog";
import { runDevLocationsSeed } from "@/server/modules/bootstrap/dev-locations";
import { createShippingService } from "@/server/modules/shipping/shipping-service";
import { getFileStorage } from "@/server/storage/storage";
import { systemClock } from "@/server/time/time";
import { CARRIER, OWNER } from "./config";

const SAFE_TEST_DB_NAME = /^[a-z0-9_]+_test$/;

async function resetDatabase(url: string): Promise<void> {
  const dbName = new URL(url).pathname.replace(/^\//, "");
  if (!SAFE_TEST_DB_NAME.test(dbName)) {
    throw new Error(`Refusing to reset "${dbName}": the E2E database name must end in "_test".`);
  }
  const adminUrl = new URL(url);
  adminUrl.pathname = "/postgres";
  adminUrl.search = "";
  const admin = new PrismaClient({
    adapter: new PrismaPg({ connectionString: adminUrl.toString() }),
  });
  try {
    // dbName is validated above, so it is safe as an identifier.
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    await admin.$executeRawUnsafe(`CREATE DATABASE "${dbName}"`);
  } finally {
    await admin.$disconnect();
  }
  execSync("npx prisma migrate deploy", { stdio: "inherit", env: process.env });
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL ?? "";
  await resetDatabase(url);
  const db = getDb();
  try {
    const clock = systemClock;
    await runBootstrap({ db, clock, hasher: createScryptHasher() }, { owner: OWNER });
    await runDevCatalogSeed(
      { db, clock, storage: getFileStorage(), logger },
      { nodeEnv: "development" },
    );
    await runDevLocationsSeed({ db, clock, logger }, { nodeEnv: "development" });
    const owner = await db.employee.findFirstOrThrow({
      where: { employeeLevel: "OWNER" },
      select: { id: true },
    });
    await createShippingService({ db, clock }).createCompany(
      { employeeId: owner.id },
      { ...CARRIER, contactInfo: null, status: "ACTIVE" },
      logger,
      "e2e-setup",
    );
  } finally {
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
