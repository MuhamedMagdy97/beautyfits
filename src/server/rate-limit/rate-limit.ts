import type { Db } from "@/server/db/transaction";

/**
 * Throttling counters stored in PostgreSQL (`rate_limit_buckets`, ADR-0013),
 * so limits hold across every app instance without Redis.
 *
 * A bucket counts hits for one key. When the count reaches `limit`, the key
 * is blocked for `blockMs`. The count starts again from 1 on the first hit
 * after the block ends, or after `windowMs` has passed since the window
 * started. `windowMs: null` counts consecutive hits: only a block ending
 * (or `resetBucket`) starts a new count.
 *
 * Callers check `getBlockedUntil` before doing the guarded work and call
 * `recordHit` for each counted event.
 */
export interface RateLimitPolicy {
  limit: number;
  windowMs: number | null;
  blockMs: number;
}

export interface BucketState {
  count: number;
  blockedUntil: Date | null;
}

/** The end of the key's block, or null when the key is not blocked at `now`. */
export async function getBlockedUntil(db: Db, key: string, now: Date): Promise<Date | null> {
  const bucket = await db.rateLimitBucket.findUnique({
    where: { key },
    select: { blockedUntil: true },
  });
  const blockedUntil = bucket?.blockedUntil ?? null;
  return blockedUntil && blockedUntil > now ? blockedUntil : null;
}

/**
 * Counts one hit atomically (a single INSERT … ON CONFLICT statement, so
 * concurrent hits on the same key are never lost) and returns the new state.
 */
export async function recordHit(
  db: Db,
  key: string,
  policy: RateLimitPolicy,
  now: Date,
): Promise<BucketState> {
  const windowCutoff = policy.windowMs === null ? null : new Date(now.getTime() - policy.windowMs);
  const blockEnd = new Date(now.getTime() + policy.blockMs);
  const firstBlock = policy.limit <= 1 ? blockEnd : null;

  const rows = await db.$queryRaw<{ count: number; blocked_until: Date | null }[]>`
    INSERT INTO rate_limit_buckets AS b (key, count, window_started_at, blocked_until, updated_at)
    VALUES (${key}, 1, ${now}::timestamptz, ${firstBlock}::timestamptz, ${now}::timestamptz)
    ON CONFLICT (key) DO UPDATE SET
      count = CASE
        WHEN (b.blocked_until IS NOT NULL AND b.blocked_until <= ${now}::timestamptz)
          OR (${windowCutoff}::timestamptz IS NOT NULL AND b.window_started_at <= ${windowCutoff}::timestamptz)
        THEN 1 ELSE b.count + 1 END,
      window_started_at = CASE
        WHEN (b.blocked_until IS NOT NULL AND b.blocked_until <= ${now}::timestamptz)
          OR (${windowCutoff}::timestamptz IS NOT NULL AND b.window_started_at <= ${windowCutoff}::timestamptz)
        THEN ${now}::timestamptz ELSE b.window_started_at END,
      blocked_until = CASE
        WHEN (CASE
          WHEN (b.blocked_until IS NOT NULL AND b.blocked_until <= ${now}::timestamptz)
            OR (${windowCutoff}::timestamptz IS NOT NULL AND b.window_started_at <= ${windowCutoff}::timestamptz)
          THEN 1 ELSE b.count + 1 END) >= ${policy.limit}
        THEN ${blockEnd}::timestamptz
        WHEN b.blocked_until IS NOT NULL AND b.blocked_until <= ${now}::timestamptz THEN NULL
        ELSE b.blocked_until END,
      updated_at = ${now}::timestamptz
    RETURNING count, blocked_until`;

  const row = rows[0];
  return { count: Number(row.count), blockedUntil: row.blocked_until };
}

/** Forgets a key, e.g. the failed-login counter after a successful login. */
export async function resetBucket(db: Db, key: string): Promise<void> {
  await db.rateLimitBucket.deleteMany({ where: { key } });
}

/** Whole seconds until `until` (at least 1), for `retryAfterSeconds` details. */
export function secondsUntil(until: Date, now: Date): number {
  return Math.max(1, Math.ceil((until.getTime() - now.getTime()) / 1000));
}
