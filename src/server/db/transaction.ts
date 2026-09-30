import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { getDb } from "@/server/db/client";

/**
 * Transaction helper (ADR-0010). Atomic business operations (checkout,
 * reservations, wallet ledger, …) run their writes through this helper so
 * that either all of them commit or none do.
 */

export type TransactionClient = Prisma.TransactionClient;

/** A database handle a service can use inside or outside a transaction. */
export type Db = PrismaClient | TransactionClient;

export type IsolationLevel = Prisma.TransactionIsolationLevel;
export const IsolationLevel = Prisma.TransactionIsolationLevel;

export interface TransactionOptions {
  /** Defaults to PostgreSQL's default (Read Committed). */
  isolationLevel?: IsolationLevel;
  /** Retries of the whole function after a serialization/write conflict. Default 0. */
  maxRetries?: number;
  /** Maximum time the transaction may run. Default 10 s. */
  timeoutMs?: number;
  /** Maximum time to wait for a connection. Default 5 s. */
  maxWaitMs?: number;
}

export const DEFAULT_TRANSACTION_TIMEOUT_MS = 10_000;
export const DEFAULT_TRANSACTION_MAX_WAIT_MS = 5_000;

/** Prisma reports serialization failures and write conflicts as P2034. */
export function isRetryableTransactionError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";
}

/**
 * Runs `fn` in one database transaction. A retried `fn` runs again from the
 * start, so it must not cause side effects outside the database (external
 * calls belong after commit, via the outbox).
 */
export async function runInTransaction<T>(
  fn: (tx: TransactionClient) => Promise<T>,
  options: TransactionOptions = {},
  db: PrismaClient = getDb(),
): Promise<T> {
  const maxRetries = Math.max(0, options.maxRetries ?? 0);

  for (let attempt = 0; ; attempt++) {
    try {
      return await db.$transaction(fn, {
        isolationLevel: options.isolationLevel,
        timeout: options.timeoutMs ?? DEFAULT_TRANSACTION_TIMEOUT_MS,
        maxWait: options.maxWaitMs ?? DEFAULT_TRANSACTION_MAX_WAIT_MS,
      });
    } catch (error) {
      if (attempt < maxRetries && isRetryableTransactionError(error)) {
        continue;
      }
      throw error;
    }
  }
}
