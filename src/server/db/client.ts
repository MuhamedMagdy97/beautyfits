import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { getEnv } from "@/server/config/env";

/**
 * Single PrismaClient per process (ADR-0003), created lazily so that
 * importing this module never requires DATABASE_URL (e.g. during build).
 * Cached on globalThis so dev hot-reload does not exhaust connections.
 *
 * Only server modules may import this. Route handlers go through modules.
 */
const globalForDb = globalThis as unknown as { beautyfitsDb?: PrismaClient };

export function getDb(): PrismaClient {
  globalForDb.beautyfitsDb ??= new PrismaClient({
    adapter: new PrismaPg({ connectionString: getEnv().DATABASE_URL }),
  });
  return globalForDb.beautyfitsDb;
}

export async function pingDatabase(): Promise<void> {
  await getDb().$queryRaw`SELECT 1`;
}
