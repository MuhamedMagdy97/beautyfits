import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/server/db/client";
import { runInTransaction } from "@/server/db/transaction";
import { resetDatabase } from "@/test/integration/database";

const db = getDb();

function outboxEvent(eventType: string) {
  return {
    eventType,
    aggregateType: "TEST",
    aggregateId: crypto.randomUUID(),
    payload: { hello: "world" },
  };
}

function idempotencyKey(key: string) {
  return {
    scope: "TEST:actor-1",
    operation: "TEST_OPERATION",
    key,
    requestFingerprint: "fingerprint",
    expiresAt: new Date(Date.now() + 60_000),
  };
}

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await db.$disconnect();
});

describe("migrations", () => {
  it("created the shared-kernel tables", async () => {
    const rows = await db.$queryRaw<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name IN ('idempotency_keys', 'outbox_events')
      ORDER BY table_name`;
    expect(rows.map((r) => r.table_name)).toEqual(["idempotency_keys", "outbox_events"]);
  });

  it("generates UUIDv7 primary keys", async () => {
    const event = await db.outboxEvent.create({ data: outboxEvent("ID_CHECK") });
    expect(event.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe("runInTransaction (PostgreSQL)", () => {
  it("commits every write together", async () => {
    await runInTransaction(async (tx) => {
      await tx.outboxEvent.create({ data: outboxEvent("COMMITTED") });
      await tx.idempotencyKey.create({ data: idempotencyKey("k-commit") });
    });
    expect(await db.outboxEvent.count()).toBe(1);
    expect(await db.idempotencyKey.count()).toBe(1);
  });

  it("rolls back every write when the function throws", async () => {
    await expect(
      runInTransaction(async (tx) => {
        await tx.outboxEvent.create({ data: outboxEvent("ROLLED_BACK") });
        await tx.idempotencyKey.create({ data: idempotencyKey("k-rollback") });
        throw new Error("fail after writes");
      }),
    ).rejects.toThrow("fail after writes");
    expect(await db.outboxEvent.count()).toBe(0);
    expect(await db.idempotencyKey.count()).toBe(0);
  });

  it("rolls back when a database constraint fails, keeping earlier committed data", async () => {
    await db.idempotencyKey.create({ data: idempotencyKey("k-duplicate") });

    await expect(
      runInTransaction(async (tx) => {
        await tx.outboxEvent.create({ data: outboxEvent("SHOULD_NOT_PERSIST") });
        await tx.idempotencyKey.create({ data: idempotencyKey("k-duplicate") });
      }),
    ).rejects.toMatchObject({ code: "P2002" });

    expect(await db.outboxEvent.count()).toBe(0);
    expect(await db.idempotencyKey.count()).toBe(1);
  });
});
