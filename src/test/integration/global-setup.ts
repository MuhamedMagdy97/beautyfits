import { execSync } from "node:child_process";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client";

/**
 * Integration-test global setup (ADR-0010).
 *
 * Drops and recreates the test database, then applies every migration with
 * `prisma migrate deploy`. Running this on every test run proves that a clean
 * database can be built entirely from migrations.
 */

const SAFE_TEST_DB_NAME = /^[a-z0-9_]+_test$/;

export default async function setup(): Promise<void> {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error("TEST_DATABASE_URL is not set. Copy it from .env.example into .env.");
  }

  const parsed = new URL(url);
  const dbName = parsed.pathname.replace(/^\//, "");
  if (!SAFE_TEST_DB_NAME.test(dbName)) {
    throw new Error(
      `Refusing to reset database "${dbName}": the test database name must end in "_test" (lowercase letters, digits, underscores).`,
    );
  }

  // Connect to the server's maintenance database to drop/create the test database.
  const adminUrl = new URL(url);
  adminUrl.pathname = "/postgres";
  adminUrl.search = "";
  const admin = new PrismaClient({ adapter: new PrismaPg({ connectionString: adminUrl.toString() }) });
  try {
    // dbName is validated above, so it is safe to use as an identifier.
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    await admin.$executeRawUnsafe(`CREATE DATABASE "${dbName}"`);
  } finally {
    await admin.$disconnect();
  }

  execSync("npx prisma migrate deploy", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: url },
  });
}
