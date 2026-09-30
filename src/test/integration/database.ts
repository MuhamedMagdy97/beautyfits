import { getDb } from "@/server/db/client";

/**
 * Removes all rows from every application table (not the migrations table).
 * Integration tests call this in `beforeEach`. Test-only: never import it
 * from application code.
 */
export async function resetDatabase(): Promise<void> {
  const db = getDb();
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length === 0) {
    return;
  }
  const list = tables.map((t) => `"public"."${t.tablename.replace(/"/g, '""')}"`).join(", ");
  await db.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}
