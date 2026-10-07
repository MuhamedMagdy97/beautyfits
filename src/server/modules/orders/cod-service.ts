import type { PrismaClient } from "@/generated/prisma/client";
import { getDb } from "@/server/db/client";
import { runInTransaction, type Db } from "@/server/db/transaction";
import { AppError } from "@/server/errors/app-error";
import type { Logger } from "@/server/logging/logger";
import {
  AUDIT_ENTITY_TYPES,
  employeeActor,
  recordAudit,
  SYSTEM_ACTOR,
  type AuditActor,
} from "@/server/modules/audit/audit";
import { generateToken, hashToken, isWellFormedToken } from "@/server/modules/auth/tokens";
import { releaseDiscountUsage } from "@/server/modules/discounts/discounts-service";
import { releaseForOrder } from "@/server/modules/inventory/reservations";
import { changeOrderStatus, lockOrder, orderNotFound } from "@/server/modules/orders/orders";
import {
  createOrdersService,
  type AdminOrderView,
  type OrderActor,
} from "@/server/modules/orders/orders-service";
import { readCodSettings } from "@/server/modules/settings/settings";
import { releaseWalletReservation } from "@/server/modules/wallet/wallet-service";
import { getBlockedUntil, recordHit, type RateLimitPolicy } from "@/server/rate-limit/rate-limit";
import { MS_PER_HOUR, systemClock, type Clock } from "@/server/time/time";

/**
 * COD confirmation and expiry (TASK-031; Business Spec Q25, Q27, Q31, Q54,
 * R1, R10, R16, R21, R36, R39; User Flows §7; ADR-0037).
 *
 * - A `PENDING_CONFIRMATION` order has a deadline fixed at checkout
 *   (timeout setting, at most 72 hours). Until then the customer confirms
 *   through the WhatsApp secure link (`confirm-cod`, source `WHATSAPP`) or
 *   staff record a phone confirmation (`RECORD_COD_CONFIRMATION`, source
 *   `PHONE`). Either way the System moves the order to `NEW` (R1).
 * - Link tokens are issued by the WhatsApp sender (`issueConfirmationToken`)
 *   when it sends the request or a reminder; only their hash is stored and
 *   they expire with the deadline. A link only confirms (R16).
 * - `sendReminders` (WhatsApp channel only) queues up to the configured
 *   number of reminders at the configured interval, before the deadline.
 * - `expireOrders` moves orders past their deadline to `EXPIRED` and gives
 *   back their stock, discount use and wallet hold (Q25, Q31, R36).
 */

/** Link confirmations per IP: 20 per hour (as checkout, ADR-0035). */
export const COD_CONFIRM_IP_LIMIT: RateLimitPolicy = {
  limit: 20,
  windowMs: MS_PER_HOUR,
  blockMs: MS_PER_HOUR,
};

interface Ctx {
  logger: Logger;
  correlationId: string | null;
}

/** What the secure link returns: no status, tracking or cancellation (R16). */
export interface CodConfirmationView {
  orderNumber: string;
  codConfirmedAt: string;
}

function deadlinePassed(status: string): AppError {
  return new AppError("ORDER_STATE_INVALID", "The confirmation time for this order has ended.", {
    details: { status, to: "NEW", reason: "CONFIRMATION_DEADLINE_PASSED" },
  });
}

export function createCodService(deps: { db: PrismaClient; clock: Clock }) {
  const { db, clock } = deps;
  const orders = createOrdersService(deps);

  /**
   * Records the confirmation and lets the System move the order to `NEW`
   * (R1, R10). Runs in the caller's transaction.
   */
  async function confirm(
    tx: Db,
    input: {
      orderId: string;
      source: "WHATSAPP" | "PHONE";
      auditActor: AuditActor;
      employeeId: string | null;
      now: Date;
      ctx: Ctx;
    },
  ): Promise<void> {
    const { orderId, now } = input;
    const status = await lockOrder(tx, orderId);
    const order = await tx.order.findUniqueOrThrow({
      where: { id: orderId },
      select: { codConfirmationDeadlineAt: true },
    });
    if (
      status === "PENDING_CONFIRMATION" &&
      order.codConfirmationDeadlineAt !== null &&
      order.codConfirmationDeadlineAt <= now
    ) {
      throw deadlinePassed(status);
    }
    await changeOrderStatus(tx, {
      orderId,
      to: "NEW",
      actor: SYSTEM_ACTOR,
      now,
      reason: `COD_CONFIRMED_${input.source}`,
      data: {
        codConfirmationSource: input.source,
        codConfirmedAt: now,
        ...(input.employeeId
          ? { codConfirmationRecordedBy: { connect: { id: input.employeeId } } }
          : {}),
      },
    });
    await recordAudit(tx, {
      actor: input.auditActor,
      action: "ORDER_COD_CONFIRMED",
      entityType: AUDIT_ENTITY_TYPES.order,
      entityId: orderId,
      previous: { status },
      next: { status: "NEW", codConfirmationSource: input.source },
      correlationId: input.ctx.correlationId,
      createdAt: now,
    });
    await tx.outboxEvent.create({
      data: {
        eventType: "ORDER_COD_CONFIRMED",
        aggregateType: "ORDER",
        aggregateId: orderId,
        payload: { orderId, source: input.source, correlationId: input.ctx.correlationId },
        availableAt: now,
        createdAt: now,
      },
    });
  }

  /**
   * A new secure-link token for a pending order, valid until its deadline.
   * For the WhatsApp sender (TASK-045): it puts the token in the link.
   */
  async function issueConfirmationToken(
    orderId: string,
  ): Promise<{ token: string; expiresAt: Date }> {
    const now = clock.now();
    const order = await db.order.findUnique({
      where: { id: orderId },
      select: { status: true, codConfirmationDeadlineAt: true },
    });
    if (!order) {
      throw orderNotFound();
    }
    const deadline = order.codConfirmationDeadlineAt;
    if (order.status !== "PENDING_CONFIRMATION" || deadline === null) {
      throw new AppError("ORDER_STATE_INVALID", "This order is not waiting for confirmation.", {
        details: { status: order.status, to: "NEW" },
      });
    }
    if (deadline <= now) {
      throw deadlinePassed(order.status);
    }
    const token = generateToken("cod");
    await db.codConfirmationToken.create({
      data: { orderId, tokenHash: hashToken(token), expiresAt: deadline, createdAt: now },
    });
    return { token, expiresAt: deadline };
  }

  /** `POST /orders/{orderId}/confirm-cod` (WhatsApp secure link). */
  async function confirmByLink(
    orderId: string,
    token: string,
    ip: string | null,
    ctx: Ctx,
  ): Promise<CodConfirmationView> {
    const now = clock.now();
    const ipKey = `cod-confirm:ip:${ip ?? "unknown"}`;
    const until = await getBlockedUntil(db, ipKey, now);
    if (until) {
      throw new AppError("RATE_LIMITED", "Too many attempts. Try again later.", {
        details: { retryAfterSeconds: Math.ceil((until.getTime() - now.getTime()) / 1000) },
      });
    }
    await recordHit(db, ipKey, COD_CONFIRM_IP_LIMIT, now);

    // Unknown, foreign and expired links all look the same.
    if (!isWellFormedToken("cod", token)) {
      throw orderNotFound();
    }
    const row = await db.codConfirmationToken.findUnique({
      where: { tokenHash: hashToken(token) },
    });
    if (!row || row.orderId !== orderId) {
      throw orderNotFound();
    }

    await runInTransaction(
      async (tx) => {
        const status = await lockOrder(tx, orderId);
        const used = await tx.codConfirmationToken.findUniqueOrThrow({ where: { id: row.id } });
        if (used.usedAt !== null) {
          return; // A retry of a confirmed link: answer as before.
        }
        if (status !== "PENDING_CONFIRMATION") {
          throw new AppError("ORDER_STATE_INVALID", `An order in ${status} cannot be confirmed.`, {
            details: { status, to: "NEW" },
          });
        }
        if (used.expiresAt <= now) {
          throw deadlinePassed(status);
        }
        const order = await tx.order.findUniqueOrThrow({
          where: { id: orderId },
          select: { customerId: true },
        });
        await tx.codConfirmationToken.update({ where: { id: row.id }, data: { usedAt: now } });
        await confirm(tx, {
          orderId,
          source: "WHATSAPP",
          auditActor: order.customerId ? { type: "CUSTOMER", id: order.customerId } : SYSTEM_ACTOR,
          employeeId: null,
          now,
          ctx,
        });
      },
      {},
      db,
    );

    const order = await db.order.findUniqueOrThrow({
      where: { id: orderId },
      select: { orderNumber: true, codConfirmedAt: true },
    });
    ctx.logger.info("cod confirmed", { orderId, source: "WHATSAPP" });
    return {
      orderNumber: order.orderNumber,
      codConfirmedAt: order.codConfirmedAt!.toISOString(),
    };
  }

  /** `POST /admin/orders/{orderId}/record-phone-confirmation` (R10). */
  async function recordPhoneConfirmation(
    actor: OrderActor,
    orderId: string,
    ctx: Ctx,
  ): Promise<AdminOrderView> {
    const now = clock.now();
    await runInTransaction(
      (tx) =>
        confirm(tx, {
          orderId,
          source: "PHONE",
          auditActor: employeeActor(actor.employeeId),
          employeeId: actor.employeeId,
          now,
          ctx,
        }),
      {},
      db,
    );
    ctx.logger.info("cod confirmed", { orderId, source: "PHONE" });
    return orders.getOrder(orderId, actor.permissions);
  }

  /**
   * Queues the due reminders (Q54, R39): WhatsApp channel only, before the
   * deadline, at most the configured count, one interval after the request
   * or the previous reminder. Run every few minutes; safe to run at any time.
   */
  async function sendReminders(): Promise<number> {
    const now = clock.now();
    const settings = await readCodSettings(db);
    if (settings.channel !== "WHATSAPP" || settings.reminderMaxCount === 0) {
      return 0;
    }
    const dueBefore = new Date(now.getTime() - settings.reminderIntervalHours * MS_PER_HOUR);
    const due = await db.order.findMany({
      where: {
        status: "PENDING_CONFIRMATION",
        codConfirmationDeadlineAt: { gt: now },
        codReminderCount: { lt: settings.reminderMaxCount },
        OR: [
          { codLastReminderAt: { lte: dueBefore } },
          { codLastReminderAt: null, createdAt: { lte: dueBefore } },
        ],
      },
      select: { id: true, codReminderCount: true },
    });
    let sent = 0;
    for (const order of due) {
      const queued = await runInTransaction(
        async (tx) => {
          // Only if nobody else sent it meanwhile.
          const { count } = await tx.order.updateMany({
            where: {
              id: order.id,
              status: "PENDING_CONFIRMATION",
              codReminderCount: order.codReminderCount,
            },
            data: {
              codReminderCount: order.codReminderCount + 1,
              codLastReminderAt: now,
              updatedAt: now,
            },
          });
          if (count === 0) {
            return false;
          }
          await tx.outboxEvent.create({
            data: {
              eventType: "COD_CONFIRMATION_REMINDER",
              aggregateType: "ORDER",
              aggregateId: order.id,
              payload: { orderId: order.id, reminderNumber: order.codReminderCount + 1 },
              availableAt: now,
              createdAt: now,
            },
          });
          return true;
        },
        {},
        db,
      );
      if (queued) sent += 1;
    }
    return sent;
  }

  /**
   * `PENDING_CONFIRMATION → EXPIRED` once the deadline has passed (Q25, Q31):
   * releases the stock, the discount use and the wallet hold. The order is
   * kept. Run every few minutes; safe to run at any time.
   */
  async function expireOrders(): Promise<number> {
    const now = clock.now();
    const due = await db.order.findMany({
      where: { status: "PENDING_CONFIRMATION", codConfirmationDeadlineAt: { lte: now } },
      select: { id: true },
    });
    let expired = 0;
    for (const { id: orderId } of due) {
      const done = await runInTransaction(
        async (tx) => {
          if ((await lockOrder(tx, orderId)) !== "PENDING_CONFIRMATION") {
            return false; // Confirmed or cancelled meanwhile.
          }
          await changeOrderStatus(tx, {
            orderId,
            to: "EXPIRED",
            actor: SYSTEM_ACTOR,
            now,
            reason: "COD_CONFIRMATION_TIMEOUT",
            data: { expiredAt: now },
          });
          await releaseForOrder(tx, {
            orderId,
            actor: SYSTEM_ACTOR,
            now,
            reason: "COD_CONFIRMATION_TIMEOUT",
          });
          await releaseDiscountUsage(tx, orderId, now);
          await releaseWalletReservation(tx, { orderId, now });
          await recordAudit(tx, {
            actor: SYSTEM_ACTOR,
            action: "ORDER_EXPIRED",
            entityType: AUDIT_ENTITY_TYPES.order,
            entityId: orderId,
            previous: { status: "PENDING_CONFIRMATION" },
            next: { status: "EXPIRED" },
            reason: "COD_CONFIRMATION_TIMEOUT",
            createdAt: now,
          });
          await tx.outboxEvent.create({
            data: {
              eventType: "ORDER_EXPIRED",
              aggregateType: "ORDER",
              aggregateId: orderId,
              payload: { orderId },
              availableAt: now,
              createdAt: now,
            },
          });
          return true;
        },
        {},
        db,
      );
      if (done) expired += 1;
    }
    return expired;
  }

  return {
    issueConfirmationToken,
    confirmByLink,
    recordPhoneConfirmation,
    sendReminders,
    expireOrders,
  };
}

export type CodService = ReturnType<typeof createCodService>;

let defaultService: CodService | undefined;

export function getCodService(): CodService {
  defaultService ??= createCodService({ db: getDb(), clock: systemClock });
  return defaultService;
}
