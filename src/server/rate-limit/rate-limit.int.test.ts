import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/server/db/client";
import {
  getBlockedUntil,
  recordHit,
  resetBucket,
  type RateLimitPolicy,
} from "@/server/rate-limit/rate-limit";
import { resetDatabase } from "@/test/integration/database";

const db = getDb();
const T0 = new Date("2026-09-30T10:00:00.000Z");
const at = (ms: number) => new Date(T0.getTime() + ms);

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await db.$disconnect();
});

describe("rate-limit buckets", () => {
  const windowed: RateLimitPolicy = { limit: 3, windowMs: 60_000, blockMs: 120_000 };
  const consecutive: RateLimitPolicy = { limit: 3, windowMs: null, blockMs: 120_000 };

  it("blocks when the limit is reached, until the block ends", async () => {
    await recordHit(db, "k", windowed, at(0));
    await recordHit(db, "k", windowed, at(1));
    expect(await getBlockedUntil(db, "k", at(2))).toBeNull();
    const state = await recordHit(db, "k", windowed, at(2));
    expect(state).toEqual({ count: 3, blockedUntil: at(120_002) });
    expect(await getBlockedUntil(db, "k", at(120_001))).toEqual(at(120_002));
    expect(await getBlockedUntil(db, "k", at(120_002))).toBeNull();
  });

  it("starts a new window after windowMs", async () => {
    await recordHit(db, "k", windowed, at(0));
    await recordHit(db, "k", windowed, at(1));
    const state = await recordHit(db, "k", windowed, at(60_000));
    expect(state).toEqual({ count: 1, blockedUntil: null });
  });

  it("counts consecutive hits without a window until a block ends or a reset", async () => {
    await recordHit(db, "k", consecutive, at(0));
    await recordHit(db, "k", consecutive, at(10 * 86_400_000));
    expect((await recordHit(db, "k", consecutive, at(20 * 86_400_000))).count).toBe(3);

    const after = at(20 * 86_400_000 + 120_000);
    expect(await recordHit(db, "k", consecutive, after)).toEqual({ count: 1, blockedUntil: null });

    await resetBucket(db, "k");
    expect(await db.rateLimitBucket.count()).toBe(0);
  });

  it("never loses concurrent hits", async () => {
    const policy: RateLimitPolicy = { limit: 1000, windowMs: 60_000, blockMs: 1 };
    await Promise.all(Array.from({ length: 25 }, () => recordHit(db, "k", policy, at(0))));
    const bucket = await db.rateLimitBucket.findUniqueOrThrow({ where: { key: "k" } });
    expect(bucket.count).toBe(25);
  });
});
