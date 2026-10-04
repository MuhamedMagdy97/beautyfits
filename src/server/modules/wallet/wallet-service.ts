import { createHash } from "node:crypto";
import type {
  PrismaClient,
  WalletDirection,
  WalletTransactionType,
} from "@/generated/prisma/client";
import { getDb } from "@/server/db/client";
import { runInTransaction, type Db } from "@/server/db/transaction";
import { AppError } from "@/server/errors/app-error";
import type { Pagination } from "@/server/http/response";
import type { Logger } from "@/server/logging/logger";
import { AUDIT_ENTITY_TYPES, employeeActor, recordAudit } from "@/server/modules/audit/audit";
import { conflict, isUniqueViolation } from "@/server/modules/catalog/errors";
import type { AdjustWalletInput, WalletTransactionsQuery } from "@/server/modules/wallet/schemas";
import { toJsonNumber } from "@/server/money/money";
import { MS_PER_DAY, systemClock, type Clock } from "@/server/time/time";

/**
 * Customer wallet (TASK-028, Business Spec Q26, Q78, Q166–Q170, C4,
 * Audit Correction 5; User Flows §12; ADR-0034).
 *
 * - Every balance change is one append-only `wallet_transactions` row; its
 *   trigger updates `wallets.balance`, which can never go below zero.
 * - Wallet credit used by a pending order is reserved, not spent: available
 *   = balance − active reservations. Checkout (TASK-029) calls
 *   `reserveWallet`; cancellation/expiry (TASK-031/TASK-033) call
 *   `releaseWalletReservation` (no ledger entry: nothing was spent); the
 *   order outcome calls `captureWalletReservation`, which writes the
 *   ORDER_WALLET_USE debit. Refunds call `creditWallet` (TASK-040).
 * - These run inside the caller's transaction. Each locks the wallet row
 *   first, so concurrent spends of the same credit serialize; release and
 *   capture do nothing when the order holds nothing, so retries are safe.
 */

export const ORDER_REFERENCE_TYPE = "ORDER";

const ADJUST_OPERATION = "WALLET_ADJUSTMENT";
const IDEMPOTENCY_TTL_MS = 7 * MS_PER_DAY;
const ZERO = BigInt(0);

interface LockedWallet {
  id: string;
  balance: bigint;
}

/** Locks the customer's wallet; null when the customer has none yet. */
async function lockWallet(tx: Db, customerId: string): Promise<LockedWallet | null> {
  const rows = await tx.$queryRaw<LockedWallet[]>`
    SELECT id, balance FROM wallets WHERE customer_id = ${customerId}::uuid FOR UPDATE`;
  return rows[0] ?? null;
}

/** Creates the customer's (empty) wallet if needed, then locks it. */
async function ensureWallet(tx: Db, customerId: string): Promise<LockedWallet> {
  // ON CONFLICT DO NOTHING: a concurrent first credit waits, then finds the row.
  await tx.wallet.createMany({ data: [{ customerId }], skipDuplicates: true });
  return (await lockWallet(tx, customerId))!;
}

async function reservedTotal(tx: Db, walletId: string): Promise<bigint> {
  const sum = await tx.walletReservation.aggregate({
    where: { walletId, status: "ACTIVE" },
    _sum: { amount: true },
  });
  return sum._sum.amount ?? ZERO;
}

function insufficientFunds(available: bigint): AppError {
  return new AppError("WALLET_INSUFFICIENT_FUNDS", "The wallet does not hold enough credit.", {
    details: { available: toJsonNumber(available) },
  });
}

function assertPositive(amount: bigint): void {
  if (amount <= ZERO) {
    throw new RangeError(`A wallet amount must be positive, got ${amount}`);
  }
}

interface PostInput {
  walletId: string;
  transactionType: WalletTransactionType;
  direction: WalletDirection;
  amount: bigint;
  referenceType?: string | null;
  referenceId?: string | null;
  reason?: string | null;
  now: Date;
}

async function postTransaction(tx: Db, input: PostInput): Promise<string> {
  const row = await tx.walletTransaction.create({
    data: {
      walletId: input.walletId,
      transactionType: input.transactionType,
      direction: input.direction,
      amount: input.amount,
      referenceType: input.referenceType ?? null,
      referenceId: input.referenceId ?? null,
      reason: input.reason ?? null,
      createdAt: input.now,
    },
  });
  return row.id;
}

/**
 * Holds `amount` of the customer's available credit for an order (C4, Q167,
 * Q168). `WALLET_INSUFFICIENT_FUNDS` when less is available;
 * `WALLET_RESERVATION_CONFLICT` when the order already holds credit.
 */
export async function reserveWallet(
  tx: Db,
  input: { customerId: string; orderId: string; amount: bigint; now: Date },
): Promise<string> {
  assertPositive(input.amount);
  const wallet = await lockWallet(tx, input.customerId);
  if (!wallet) {
    throw insufficientFunds(ZERO);
  }
  const held = await tx.walletReservation.findFirst({
    where: { orderId: input.orderId, status: "ACTIVE" },
    select: { id: true },
  });
  if (held) {
    throw new AppError(
      "WALLET_RESERVATION_CONFLICT",
      "This order already holds wallet credit; release it first.",
    );
  }
  const available = wallet.balance - (await reservedTotal(tx, wallet.id));
  if (available < input.amount) {
    throw insufficientFunds(available);
  }
  const reservation = await tx.walletReservation.create({
    data: {
      walletId: wallet.id,
      orderId: input.orderId,
      amount: input.amount,
      createdAt: input.now,
    },
  });
  return reservation.id;
}

/** The order's reservation's wallet, locked; null when the order never reserved. */
async function lockOrderWallet(tx: Db, orderId: string): Promise<string | null> {
  const any = await tx.walletReservation.findFirst({
    where: { orderId },
    select: { walletId: true },
  });
  if (!any) {
    return null;
  }
  await tx.$queryRaw`SELECT id FROM wallets WHERE id = ${any.walletId}::uuid FOR UPDATE`;
  return any.walletId;
}

/**
 * Gives an order's held credit back (cancelled or expired before it was
 * spent, Audit Correction 5). Not a refund: no ledger entry. Idempotent;
 * returns the amount released.
 */
export async function releaseWalletReservation(
  tx: Db,
  input: { orderId: string; now: Date },
): Promise<bigint> {
  if (!(await lockOrderWallet(tx, input.orderId))) {
    return ZERO;
  }
  const held = await tx.walletReservation.findFirst({
    where: { orderId: input.orderId, status: "ACTIVE" },
  });
  if (!held) {
    return ZERO;
  }
  await tx.walletReservation.update({
    where: { id: held.id },
    data: { status: "RELEASED", releasedAt: input.now },
  });
  return held.amount;
}

/**
 * Spends an order's held credit: the reservation becomes CAPTURED and an
 * ORDER_WALLET_USE debit is written (User Flows §12.2). Idempotent; returns
 * the amount captured.
 */
export async function captureWalletReservation(
  tx: Db,
  input: { orderId: string; now: Date },
): Promise<bigint> {
  const walletId = await lockOrderWallet(tx, input.orderId);
  if (!walletId) {
    return ZERO;
  }
  const held = await tx.walletReservation.findFirst({
    where: { orderId: input.orderId, status: "ACTIVE" },
  });
  if (!held) {
    return ZERO;
  }
  await tx.walletReservation.update({
    where: { id: held.id },
    data: { status: "CAPTURED", capturedAt: input.now },
  });
  await postTransaction(tx, {
    walletId,
    transactionType: "ORDER_WALLET_USE",
    direction: "DEBIT",
    amount: held.amount,
    referenceType: ORDER_REFERENCE_TYPE,
    referenceId: input.orderId,
    now: input.now,
  });
  return held.amount;
}

/**
 * Adds credit to the customer's wallet (refunds, TASK-040), creating the
 * wallet on first use. Returns the transaction id.
 */
export async function creditWallet(
  tx: Db,
  input: {
    customerId: string;
    transactionType: Exclude<WalletTransactionType, "ORDER_WALLET_USE" | "MANUAL_ADJUSTMENT">;
    amount: bigint;
    referenceType: string;
    referenceId: string;
    reason?: string | null;
    now: Date;
  },
): Promise<string> {
  assertPositive(input.amount);
  const wallet = await ensureWallet(tx, input.customerId);
  return postTransaction(tx, { ...input, walletId: wallet.id, direction: "CREDIT" });
}

/** R34: the wallet balance (held credit included) that blocks deactivation. */
export async function walletBalance(tx: Db, customerId: string): Promise<bigint> {
  const wallet = await tx.wallet.findUnique({ where: { customerId }, select: { balance: true } });
  return wallet?.balance ?? ZERO;
}

export interface WalletView {
  customerId: string;
  currency: string;
  /** Everything in the wallet, held credit included. */
  balance: number;
  /** Held for pending orders. */
  reserved: number;
  /** What the customer can spend now. */
  available: number;
}

export interface WalletTransactionView {
  id: string;
  type: WalletTransactionType;
  direction: WalletDirection;
  amount: number;
  /** + credit, − debit. */
  signedAmount: number;
  referenceType: string | null;
  referenceId: string | null;
  /** Staff-only: manual adjustment reasons may be internal notes. */
  reason?: string | null;
  createdAt: string;
}

interface Ctx {
  logger: Logger;
  correlationId: string | null;
}

function customerNotFound(): AppError {
  return new AppError("NOT_FOUND", "Customer not found.");
}

export function createWalletService(deps: { db: PrismaClient; clock: Clock }) {
  const { db, clock } = deps;

  async function getWallet(customerId: string): Promise<WalletView> {
    const wallet = await db.wallet.findUnique({ where: { customerId } });
    const balance = wallet?.balance ?? ZERO;
    const reserved = wallet ? await reservedTotal(db, wallet.id) : ZERO;
    return {
      customerId,
      currency: wallet?.currency ?? "EGP",
      balance: toJsonNumber(balance),
      reserved: toJsonNumber(reserved),
      available: toJsonNumber(balance - reserved),
    };
  }

  async function listTransactions(
    customerId: string,
    query: WalletTransactionsQuery,
    options: { withReason: boolean },
  ): Promise<{ items: WalletTransactionView[]; pagination: Pagination }> {
    const where = { wallet: { customerId } };
    const [total, rows] = await Promise.all([
      db.walletTransaction.count({ where }),
      db.walletTransaction.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return {
      items: rows.map((row) => ({
        id: row.id,
        type: row.transactionType,
        direction: row.direction,
        amount: toJsonNumber(row.amount),
        signedAmount: toJsonNumber(row.direction === "CREDIT" ? row.amount : -row.amount),
        referenceType: row.referenceType,
        referenceId: row.referenceId,
        ...(options.withReason ? { reason: row.reason } : {}),
        createdAt: row.createdAt.toISOString(),
      })),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.ceil(total / query.pageSize),
      },
    };
  }

  async function assertCustomer(customerId: string): Promise<void> {
    if (!(await db.customer.findUnique({ where: { id: customerId }, select: { id: true } }))) {
      throw customerNotFound();
    }
  }

  /** `GET /admin/customers/{id}/wallet` (`VIEW_WALLET_BALANCE`). */
  async function getCustomerWallet(customerId: string): Promise<WalletView> {
    await assertCustomer(customerId);
    return getWallet(customerId);
  }

  /** `GET /admin/customers/{id}/wallet/transactions` (`VIEW_WALLET_BALANCE`). */
  async function listCustomerTransactions(customerId: string, query: WalletTransactionsQuery) {
    await assertCustomer(customerId);
    return listTransactions(customerId, query, { withReason: true });
  }

  /**
   * `POST /admin/customers/{id}/wallet/adjust` (`ADJUST_WALLET`, Owner/Admin
   * only, Q78): one MANUAL_ADJUSTMENT transaction with its reason, audited.
   * A debit may take only available credit (never held credit). Retrying
   * with the same Idempotency-Key and body returns the same transaction.
   */
  async function adjust(
    actor: { employeeId: string },
    customerId: string,
    input: AdjustWalletInput,
    idempotencyKey: string,
    ctx: Ctx,
  ): Promise<{ transactionId: string; wallet: WalletView }> {
    const now = clock.now();
    const scope = `EMPLOYEE:${actor.employeeId}`;
    const print = createHash("sha256")
      .update(JSON.stringify({ customerId, input }, (_, v) => (typeof v === "bigint" ? `${v}` : v)))
      .digest("hex");

    const result = await runInTransaction(
      async (tx) => {
        // The customer lock serializes retries of the same key (and matches
        // the lock order of deactivation, R34).
        const customers = await tx.$queryRaw<{ anonymized_at: Date | null }[]>`
          SELECT anonymized_at FROM customers WHERE id = ${customerId}::uuid FOR UPDATE`;
        if (customers.length === 0) {
          throw customerNotFound();
        }
        const previous = await tx.idempotencyKey.findUnique({
          where: {
            scope_operation_key: { scope, operation: ADJUST_OPERATION, key: idempotencyKey },
          },
        });
        if (previous) {
          if (previous.requestFingerprint !== print) {
            throw new AppError(
              "IDEMPOTENCY_CONFLICT",
              "This Idempotency-Key was used for a different request.",
            );
          }
          return { transactionId: previous.resourceId!, replayed: true };
        }
        if (customers[0].anonymized_at !== null) {
          throw conflict("The customer account is deactivated.", {
            reason: "CUSTOMER_DEACTIVATED",
          });
        }
        const wallet = await ensureWallet(tx, customerId);
        if (input.direction === "DEBIT") {
          const available = wallet.balance - (await reservedTotal(tx, wallet.id));
          if (available < input.amount) {
            throw insufficientFunds(available);
          }
        }
        const transactionId = await postTransaction(tx, {
          walletId: wallet.id,
          transactionType: "MANUAL_ADJUSTMENT",
          direction: input.direction,
          amount: input.amount,
          reason: input.reason,
          now,
        });
        const signed = input.direction === "CREDIT" ? input.amount : -input.amount;
        await recordAudit(tx, {
          actor: employeeActor(actor.employeeId),
          action: "WALLET_ADJUSTED",
          entityType: AUDIT_ENTITY_TYPES.customer,
          entityId: customerId,
          previous: { balance: toJsonNumber(wallet.balance) },
          next: {
            transactionId,
            direction: input.direction,
            amount: toJsonNumber(input.amount),
            balance: toJsonNumber(wallet.balance + signed),
          },
          reason: input.reason,
          correlationId: ctx.correlationId,
          createdAt: now,
        });
        await tx.idempotencyKey.create({
          data: {
            scope,
            operation: ADJUST_OPERATION,
            key: idempotencyKey,
            requestFingerprint: print,
            status: "COMPLETED",
            responseStatus: 201,
            resourceType: "WALLET_TRANSACTION",
            resourceId: transactionId,
            createdAt: now,
            // ponytail: expired keys are not purged yet (as for receiving, ADR-0028).
            expiresAt: new Date(now.getTime() + IDEMPOTENCY_TTL_MS),
          },
        });
        return { transactionId, replayed: false };
      },
      {},
      db,
    ).catch((error: unknown) => {
      // The same key used at the same time for another customer.
      if (isUniqueViolation(error, "key")) {
        throw new AppError(
          "IDEMPOTENCY_CONFLICT",
          "This Idempotency-Key was used for a different request.",
        );
      }
      throw error;
    });

    if (!result.replayed) {
      ctx.logger.info("wallet adjusted", {
        customerId,
        walletTransactionId: result.transactionId,
        actorEmployeeId: actor.employeeId,
      });
    }
    return { transactionId: result.transactionId, wallet: await getWallet(customerId) };
  }

  return {
    /** `GET /me/wallet`. */
    getWallet,
    /** `GET /me/wallet/transactions` (no reasons). */
    listOwnTransactions: (customerId: string, query: WalletTransactionsQuery) =>
      listTransactions(customerId, query, { withReason: false }),
    getCustomerWallet,
    listCustomerTransactions,
    adjust,
  };
}

export type WalletService = ReturnType<typeof createWalletService>;

let defaultService: WalletService | undefined;

export function getWalletService(): WalletService {
  defaultService ??= createWalletService({ db: getDb(), clock: systemClock });
  return defaultService;
}
