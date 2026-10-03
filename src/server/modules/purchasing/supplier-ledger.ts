import { createHash } from "node:crypto";
import type {
  PrismaClient,
  SupplierLedgerDirection,
  SupplierLedgerEntryType,
} from "@/generated/prisma/client";
import { getDb } from "@/server/db/client";
import { runInTransaction, type Db } from "@/server/db/transaction";
import { AppError } from "@/server/errors/app-error";
import type { Pagination } from "@/server/http/response";
import type { Logger } from "@/server/logging/logger";
import { AUDIT_ENTITY_TYPES, employeeActor, recordAudit } from "@/server/modules/audit/audit";
import { isUniqueViolation, validationError } from "@/server/modules/catalog/errors";
import { assertStatus } from "@/server/modules/purchasing/purchase-orders";
import type { RecordSupplierPaymentInput } from "@/server/modules/purchasing/schemas";
import { toJsonNumber } from "@/server/money/money";
import { MS_PER_DAY, systemClock, type Clock } from "@/server/time/time";

/**
 * The supplier ledger and supplier payments (TASK-024, Audit Correction 6,
 * Business Spec Q107, Q118, Q119, API v1.1 "Supplier finance", ADR-0029).
 *
 * Every change to what we owe a supplier is one append-only ledger entry:
 * invoices raise it (CREDIT), payments and return credits lower it (DEBIT),
 * cash refunded by the supplier raises it back (CREDIT). The balance is
 * Σ CREDIT − Σ DEBIT; below zero the supplier owes us (or holds our credit).
 *
 * This file must not import approvals.ts at runtime: the supplier return
 * approval handler uses `postLedgerEntry`.
 */

const DIRECTION: Record<Exclude<SupplierLedgerEntryType, "ADJUSTMENT">, SupplierLedgerDirection> = {
  INVOICE: "CREDIT",
  PAYMENT: "DEBIT",
  CREDIT: "DEBIT",
  REFUND: "CREDIT",
};

export interface LedgerEntryInput {
  supplierId: string;
  entryType: Exclude<SupplierLedgerEntryType, "ADJUSTMENT">;
  amount: bigint;
  reference: string | null;
  purchaseOrderId?: string | null;
  supplierReturnId?: string | null;
  purchaseInvoiceId?: string | null;
  supplierPaymentId?: string | null;
  employeeId: string;
  now: Date;
}

/** Writes one ledger entry; call it in the transaction that makes the change. */
export async function postLedgerEntry(tx: Db, input: LedgerEntryInput): Promise<string> {
  const entry = await tx.supplierLedgerEntry.create({
    data: {
      supplierId: input.supplierId,
      purchaseOrderId: input.purchaseOrderId ?? null,
      supplierReturnId: input.supplierReturnId ?? null,
      purchaseInvoiceId: input.purchaseInvoiceId ?? null,
      supplierPaymentId: input.supplierPaymentId ?? null,
      entryType: input.entryType,
      direction: DIRECTION[input.entryType],
      amount: input.amount,
      reference: input.reference,
      createdByEmployeeId: input.employeeId,
      createdAt: input.now,
    },
  });
  return entry.id;
}

export function signedAmount(direction: SupplierLedgerDirection, amount: bigint): bigint {
  return direction === "CREDIT" ? amount : -amount;
}

export type PaymentStatus = "PAID" | "PARTIALLY_PAID" | "UNPAID";

/**
 * Q118 for one invoiced purchase order, from its ledger entries: nothing left
 * to pay is PAID; otherwise any payment makes it PARTIALLY_PAID.
 */
export function paymentStatus(orderBalance: bigint, paid: bigint): PaymentStatus {
  if (orderBalance <= BigInt(0)) {
    return "PAID";
  }
  return paid > BigInt(0) ? "PARTIALLY_PAID" : "UNPAID";
}

interface Ctx {
  logger: Logger;
  correlationId: string | null;
}

export interface PersonRef {
  id: string;
  displayName: string;
}

export interface SupplierPaymentView {
  id: string;
  supplierId: string;
  purchase: { id: string; purchaseNumber: string } | null;
  amount: number;
  method: string;
  paidOn: string;
  reference: string | null;
  notes: string | null;
  recordedBy: PersonRef;
  createdAt: string;
}

export interface LedgerEntryView {
  id: string;
  entryType: SupplierLedgerEntryType;
  direction: SupplierLedgerDirection;
  amount: number;
  /** + raises what we owe, − lowers it. */
  signedAmount: number;
  purchase: { id: string; purchaseNumber: string } | null;
  supplierReturn: { id: string; returnNumber: string } | null;
  purchaseInvoiceId: string | null;
  supplierPaymentId: string | null;
  reference: string | null;
  createdBy: PersonRef;
  createdAt: string;
}

export interface SupplierBalanceView {
  supplierId: string;
  currency: string;
  /** What we owe the supplier; negative when the supplier owes us. */
  balance: number;
  totals: { invoiced: number; paid: number; credited: number; refunded: number };
  /** Q118 per invoiced purchase order. */
  purchases: {
    id: string;
    purchaseNumber: string;
    invoiced: number;
    paid: number;
    balance: number;
    paymentStatus: PaymentStatus;
  }[];
}

const PAYMENT_OPERATION = "SUPPLIER_PAYMENT";
const IDEMPOTENCY_TTL_MS = 7 * MS_PER_DAY;
const person = { select: { id: true, displayName: true } } as const;

function supplierNotFound(): AppError {
  return new AppError("NOT_FOUND", "Supplier not found.");
}

async function assertSupplier(db: Db, supplierId: string): Promise<void> {
  if (!(await db.supplier.findUnique({ where: { id: supplierId }, select: { id: true } }))) {
    throw supplierNotFound();
  }
}

export function createSupplierLedgerService(deps: { db: PrismaClient; clock: Clock }) {
  const { db, clock } = deps;

  async function loadPayment(paymentId: string): Promise<SupplierPaymentView> {
    const row = await db.supplierPayment.findUniqueOrThrow({
      where: { id: paymentId },
      include: {
        purchaseOrder: { select: { id: true, purchaseNumber: true } },
        recordedBy: person,
      },
    });
    return {
      id: row.id,
      supplierId: row.supplierId,
      purchase: row.purchaseOrder,
      amount: toJsonNumber(row.amount),
      method: row.method,
      paidOn: row.paidOn.toISOString().slice(0, 10),
      reference: row.reference,
      notes: row.notes,
      recordedBy: row.recordedBy,
      createdAt: row.createdAt.toISOString(),
    };
  }

  /**
   * `POST /admin/suppliers/{id}/payments` (`SUPPLIER_PAYMENT_MANAGE`). Partial
   * payments and payments beyond what is owed are allowed (owner decision,
   * ADR-0029 §3). Retrying with the same Idempotency-Key and body returns the
   * payment already recorded.
   */
  async function recordPayment(
    actor: { employeeId: string },
    supplierId: string,
    input: RecordSupplierPaymentInput,
    idempotencyKey: string,
    ctx: Ctx,
  ): Promise<{ payment: SupplierPaymentView; balance: SupplierBalanceView }> {
    const now = clock.now();
    const scope = `EMPLOYEE:${actor.employeeId}`;
    const print = createHash("sha256")
      .update(JSON.stringify({ supplierId, input }, (_, v) => (typeof v === "bigint" ? `${v}` : v)))
      .digest("hex");

    const result = await runInTransaction(
      async (tx) => {
        // The supplier lock serializes retries of the same key.
        const rows = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM suppliers WHERE id = ${supplierId}::uuid FOR UPDATE`;
        if (rows.length === 0) {
          throw supplierNotFound();
        }
        const previous = await tx.idempotencyKey.findUnique({
          where: {
            scope_operation_key: { scope, operation: PAYMENT_OPERATION, key: idempotencyKey },
          },
        });
        if (previous) {
          if (previous.requestFingerprint !== print) {
            throw new AppError(
              "IDEMPOTENCY_CONFLICT",
              "This Idempotency-Key was used for a different request.",
            );
          }
          return { paymentId: previous.resourceId!, replayed: true };
        }
        if (input.purchaseId) {
          const order = await tx.purchaseOrder.findUnique({
            where: { id: input.purchaseId },
            select: { supplierId: true, status: true },
          });
          if (!order || order.supplierId !== supplierId) {
            throw validationError(
              "purchaseId",
              "purchase_not_found",
              "The purchase order does not exist or belongs to another supplier.",
            );
          }
          assertStatus(
            order.status,
            ["APPROVED", "SENT", "PARTIALLY_RECEIVED", "RECEIVED", "CLOSED"],
            "record a payment for",
          );
        }
        const payment = await tx.supplierPayment.create({
          data: {
            supplierId,
            purchaseOrderId: input.purchaseId ?? null,
            amount: input.amount,
            method: input.method,
            paidOn: new Date(`${input.paidOn}T00:00:00Z`),
            reference: input.reference ?? null,
            notes: input.notes ?? null,
            recordedByEmployeeId: actor.employeeId,
            createdAt: now,
          },
        });
        const ledgerEntryId = await postLedgerEntry(tx, {
          supplierId,
          entryType: "PAYMENT",
          amount: input.amount,
          reference: input.reference ?? null,
          purchaseOrderId: input.purchaseId ?? null,
          supplierPaymentId: payment.id,
          employeeId: actor.employeeId,
          now,
        });
        await recordAudit(tx, {
          actor: employeeActor(actor.employeeId),
          action: "SUPPLIER_PAYMENT_RECORDED",
          entityType: AUDIT_ENTITY_TYPES.supplier,
          entityId: supplierId,
          next: {
            paymentId: payment.id,
            ledgerEntryId,
            purchaseId: input.purchaseId ?? null,
            amount: toJsonNumber(input.amount),
            method: input.method,
            paidOn: input.paidOn,
            reference: input.reference ?? null,
          },
          reason: input.notes ?? null,
          correlationId: ctx.correlationId,
          createdAt: now,
        });
        await tx.idempotencyKey.create({
          data: {
            scope,
            operation: PAYMENT_OPERATION,
            key: idempotencyKey,
            requestFingerprint: print,
            status: "COMPLETED",
            responseStatus: 201,
            resourceType: "SUPPLIER_PAYMENT",
            resourceId: payment.id,
            createdAt: now,
            // ponytail: expired keys are not purged yet (as for receiving, ADR-0028).
            expiresAt: new Date(now.getTime() + IDEMPOTENCY_TTL_MS),
          },
        });
        return { paymentId: payment.id, replayed: false };
      },
      {},
      db,
    ).catch((error: unknown) => {
      // The same key used at the same time for another supplier.
      if (isUniqueViolation(error, "key")) {
        throw new AppError(
          "IDEMPOTENCY_CONFLICT",
          "This Idempotency-Key was used for a different request.",
        );
      }
      throw error;
    });

    if (!result.replayed) {
      ctx.logger.info("supplier payment recorded", {
        supplierId,
        supplierPaymentId: result.paymentId,
        actorEmployeeId: actor.employeeId,
      });
    }
    return { payment: await loadPayment(result.paymentId), balance: await getBalance(supplierId) };
  }

  /** `GET /admin/suppliers/{id}/ledger`, newest first (`SUPPLIER_FINANCE_VIEW`). */
  async function listLedger(
    supplierId: string,
    query: { page: number; pageSize: number },
  ): Promise<{ items: LedgerEntryView[]; pagination: Pagination }> {
    await assertSupplier(db, supplierId);
    const where = { supplierId };
    const [total, rows] = await Promise.all([
      db.supplierLedgerEntry.count({ where }),
      db.supplierLedgerEntry.findMany({
        where,
        include: {
          purchaseOrder: { select: { id: true, purchaseNumber: true } },
          supplierReturn: { select: { id: true, returnNumber: true } },
          createdBy: person,
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return {
      items: rows.map((row) => ({
        id: row.id,
        entryType: row.entryType,
        direction: row.direction,
        amount: toJsonNumber(row.amount),
        signedAmount: toJsonNumber(signedAmount(row.direction, row.amount)),
        purchase: row.purchaseOrder,
        supplierReturn: row.supplierReturn,
        purchaseInvoiceId: row.purchaseInvoiceId,
        supplierPaymentId: row.supplierPaymentId,
        reference: row.reference,
        createdBy: row.createdBy,
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

  /** `GET /admin/suppliers/{id}/balance` (`SUPPLIER_FINANCE_VIEW`, Q118, Q119). */
  async function getBalance(supplierId: string): Promise<SupplierBalanceView> {
    await assertSupplier(db, supplierId);
    const sums = await db.supplierLedgerEntry.groupBy({
      by: ["purchaseOrderId", "entryType", "direction"],
      where: { supplierId },
      _sum: { amount: true },
    });
    const zero = BigInt(0);
    const totals = { INVOICE: zero, PAYMENT: zero, CREDIT: zero, REFUND: zero, ADJUSTMENT: zero };
    let balance = zero;
    const orders = new Map<string, { invoiced: bigint; paid: bigint; balance: bigint }>();
    for (const row of sums) {
      const amount = row._sum.amount ?? zero;
      const signed = signedAmount(row.direction, amount);
      totals[row.entryType] += amount;
      balance += signed;
      if (row.purchaseOrderId) {
        const order = orders.get(row.purchaseOrderId) ?? {
          invoiced: zero,
          paid: zero,
          balance: zero,
        };
        if (row.entryType === "INVOICE") order.invoiced += amount;
        if (row.entryType === "PAYMENT") order.paid += amount;
        order.balance += signed;
        orders.set(row.purchaseOrderId, order);
      }
    }
    const invoiced = [...orders].filter(([, order]) => order.invoiced > zero);
    const numbers = new Map(
      (
        await db.purchaseOrder.findMany({
          where: { id: { in: invoiced.map(([id]) => id) } },
          select: { id: true, purchaseNumber: true },
        })
      ).map((order) => [order.id, order.purchaseNumber]),
    );
    return {
      supplierId,
      currency: "EGP",
      balance: toJsonNumber(balance),
      totals: {
        invoiced: toJsonNumber(totals.INVOICE),
        paid: toJsonNumber(totals.PAYMENT),
        credited: toJsonNumber(totals.CREDIT),
        refunded: toJsonNumber(totals.REFUND),
      },
      purchases: invoiced
        .map(([id, order]) => ({
          id,
          purchaseNumber: numbers.get(id)!,
          invoiced: toJsonNumber(order.invoiced),
          paid: toJsonNumber(order.paid),
          balance: toJsonNumber(order.balance),
          paymentStatus: paymentStatus(order.balance, order.paid),
        }))
        .sort((a, b) => a.purchaseNumber.localeCompare(b.purchaseNumber)),
    };
  }

  return { recordPayment, listLedger, getBalance };
}

export type SupplierLedgerService = ReturnType<typeof createSupplierLedgerService>;

let defaultService: SupplierLedgerService | undefined;

export function getSupplierLedgerService(): SupplierLedgerService {
  defaultService ??= createSupplierLedgerService({ db: getDb(), clock: systemClock });
  return defaultService;
}
