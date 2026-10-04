import { getDb } from "@/server/db/client";

/** Reference data inserted by migrations (the permission catalog, TASK-012; governorates, TASK-009). */
const REFERENCE_TABLES = ["_prisma_migrations", "permissions", "governorates"];

/**
 * Removes all rows from every application table (not the migrations table or
 * the reference data inserted by migrations).
 * Integration tests call this in `beforeEach`. Test-only: never import it
 * from application code.
 */
export async function resetDatabase(): Promise<void> {
  const db = getDb();
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> ALL(${REFERENCE_TABLES})`;
  if (tables.length === 0) {
    return;
  }
  const list = tables.map((t) => `"public"."${t.tablename.replace(/"/g, '""')}"`).join(", ");
  await db.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}
