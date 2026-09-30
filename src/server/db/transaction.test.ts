import { describe, expect, it, vi } from "vitest";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import {
  DEFAULT_TRANSACTION_MAX_WAIT_MS,
  DEFAULT_TRANSACTION_TIMEOUT_MS,
  IsolationLevel,
  isRetryableTransactionError,
  runInTransaction,
} from "@/server/db/transaction";

function conflict() {
  return new Prisma.PrismaClientKnownRequestError("Transaction failed due to a write conflict", {
    code: "P2034",
    clientVersion: "test",
  });
}

/** A fake client whose $transaction runs the callback with a dummy tx. */
function fakeDb(behaviour: () => Promise<unknown>) {
  const $transaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
    await behaviour();
    return fn({});
  });
  return { db: { $transaction } as unknown as PrismaClient, $transaction };
}

describe("isRetryableTransactionError", () => {
  it("accepts only Prisma write conflicts (P2034)", () => {
    expect(isRetryableTransactionError(conflict())).toBe(true);
    expect(
      isRetryableTransactionError(
        new Prisma.PrismaClientKnownRequestError("Unique constraint", {
          code: "P2002",
          clientVersion: "test",
        }),
      ),
    ).toBe(false);
    expect(isRetryableTransactionError(new Error("P2034"))).toBe(false);
  });
});

describe("runInTransaction", () => {
  it("returns the callback result and passes default options", async () => {
    const { db, $transaction } = fakeDb(async () => {});
    await expect(runInTransaction(async () => 42, {}, db)).resolves.toBe(42);
    expect($transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: undefined,
      timeout: DEFAULT_TRANSACTION_TIMEOUT_MS,
      maxWait: DEFAULT_TRANSACTION_MAX_WAIT_MS,
    });
  });

  it("passes isolation level and timeouts", async () => {
    const { db, $transaction } = fakeDb(async () => {});
    await runInTransaction(
      async () => null,
      { isolationLevel: IsolationLevel.Serializable, timeoutMs: 1_000, maxWaitMs: 500 },
      db,
    );
    expect($transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "Serializable",
      timeout: 1_000,
      maxWait: 500,
    });
  });

  it("does not retry by default", async () => {
    const { db, $transaction } = fakeDb(async () => {
      throw conflict();
    });
    await expect(runInTransaction(async () => 1, {}, db)).rejects.toMatchObject({ code: "P2034" });
    expect($transaction).toHaveBeenCalledTimes(1);
  });

  it("retries write conflicts up to maxRetries, then succeeds", async () => {
    let calls = 0;
    const { db, $transaction } = fakeDb(async () => {
      calls += 1;
      if (calls < 3) throw conflict();
    });
    await expect(runInTransaction(async () => "ok", { maxRetries: 3 }, db)).resolves.toBe("ok");
    expect($transaction).toHaveBeenCalledTimes(3);
  });

  it("gives up after maxRetries", async () => {
    const { db, $transaction } = fakeDb(async () => {
      throw conflict();
    });
    await expect(runInTransaction(async () => 1, { maxRetries: 2 }, db)).rejects.toMatchObject({
      code: "P2034",
    });
    expect($transaction).toHaveBeenCalledTimes(3);
  });

  it("never retries other errors", async () => {
    const { db, $transaction } = fakeDb(async () => {
      throw new Error("boom");
    });
    await expect(runInTransaction(async () => 1, { maxRetries: 5 }, db)).rejects.toThrow("boom");
    expect($transaction).toHaveBeenCalledTimes(1);
  });
});
