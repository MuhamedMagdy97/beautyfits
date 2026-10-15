import type { OrderStatus, PrismaClient, ShipmentStatus } from "@/generated/prisma/client";
import { getDb } from "@/server/db/client";
import { runInTransaction, type Db } from "@/server/db/transaction";
import { AppError } from "@/server/errors/app-error";
import type { Logger } from "@/server/logging/logger";
import {
  AUDIT_ENTITY_TYPES,
  employeeActor,
  recordAudit,
  recordAudits,
  SYSTEM_ACTOR,
  type AuditEntry,
} from "@/server/modules/audit/audit";
import { conflict, isUniqueViolation, validationError } from "@/server/modules/catalog/errors";
import { commitForOrder } from "@/server/modules/inventory/reservations";
import { changeOrderStatus, lockOrder, releaseOrderHolds } from "@/server/modules/orders/orders";
import {
  getOrdersService,
  type AdminOrderView,
  type OrderActor,
  type OrdersService,
} from "@/server/modules/orders/orders-service";
import { permissionDenied } from "@/server/modules/rbac/authorization";
import { openContactTaskAtThreshold } from "@/server/modules/shipping/contact-tasks-service";
import type {
  AssignShippingInput,
  InspectReturnInput,
  MarkShippedInput,
  RequestShippingCancellationInput,
  ShipmentStatusInput,
  UpdateTrackingInput,
} from "@/server/modules/shipping/schemas";
import {
  canMoveShipment,
  needsCancellationRequest,
  SHIPMENT_INCLUDE,
  toAdminShipment,
  type AdminShipmentView,
} from "@/server/modules/shipping/shipments";
import { recordShippingCancellationRequest } from "@/server/modules/shipping/shipping-cancellation";
import { captureWalletReservation, creditWallet } from "@/server/modules/wallet/wallet-service";
import { toJsonNumber } from "@/server/money/money";
import { systemClock, type Clock } from "@/server/time/time";

/**
 * Shipments and tracking (TASK-034, Business Spec Q84, Q85, Q126, Q127,
 * R2, R4, R37, R38.7; User Flows §8; API §16; ADR-0040).
 *
 * - `assign-shipping` (ASSIGN_SHIPPING) changes the order's carrier among
 *   the active contracted companies until carrier handoff; the shipping fee
 *   never changes (Q126, R37).
 * - `mark-shipped` (MARK_AS_SHIPPED) is the carrier handoff: the order moves
 *   `READY_FOR_SHIPMENT → SHIPPED`, its held stock is consumed
 *   (`commitForOrder`, ADR-0025) and its held wallet credit captured
 *   (R38.7), and the shipment is created, all in one transaction.
 * - Shipment status (MANAGE_SHIPMENT) moves `SHIPPED → OUT_FOR_DELIVERY →
 *   DELIVERED`; `DELIVERED` also needs MARK_AS_DELIVERED and moves the order
 *   `SHIPPED → DELIVERED` in the same transaction.
 * - `DELIVERY_FAILED` (TASK-035, Q128, Q129) counts a failed attempt and, at
 *   the configured threshold, opens a customer-contact task; the order stays
 *   `SHIPPED`. Another attempt goes back to `OUT_FOR_DELIVERY`.
 * - Locks: the order row first, then the shipment row.
 */

interface Ctx {
  logger: Logger;
  correlationId: string | null;
}

/** Before carrier handoff (R11): the carrier can still be changed. */
const ASSIGNABLE: readonly OrderStatus[] = [
  "PENDING_CONFIRMATION",
  "NEW",
  "CONFIRMED",
  "PREPARING",
  "READY_FOR_SHIPMENT",
];

function shipmentNotFound(): AppError {
  return new AppError("NOT_FOUND", "Shipment not found.");
}

function trackingTaken(): AppError {
  return conflict("This company already has a shipment with this tracking number.", {
    reason: "TRACKING_NUMBER_TAKEN",
  });
}

/** A unique violation of (company, tracking number) becomes a 409. */
async function mapTrackingConflict<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    throw isUniqueViolation(error, "tracking_number") ? trackingTaken() : error;
  }
}

async function assertTrackingFree(
  tx: Db,
  shippingCompanyId: string,
  trackingNumber: string,
  shipmentId: string | null,
): Promise<void> {
  const other = await tx.shipment.findFirst({
    where: {
      shippingCompanyId,
      trackingNumber,
      ...(shipmentId ? { NOT: { id: shipmentId } } : {}),
    },
    select: { id: true },
  });
  if (other) {
    throw trackingTaken();
  }
}

function outbox(
  tx: Db,
  eventType: string,
  orderId: string,
  payload: Record<string, unknown>,
  now: Date,
) {
  return tx.outboxEvent.create({
    data: {
      eventType,
      aggregateType: "ORDER",
      aggregateId: orderId,
      payload: { orderId, ...payload },
      availableAt: now,
      createdAt: now,
    },
  });
}

export function createShipmentsService(deps: {
  db: PrismaClient;
  clock: Clock;
  orders?: OrdersService;
}) {
  const { db, clock } = deps;
  const orders = () => deps.orders ?? getOrdersService();

  /** `POST /admin/orders/{orderId}/assign-shipping`. */
  async function assignShipping(
    actor: OrderActor,
    orderId: string,
    input: AssignShippingInput,
    ctx: Ctx,
  ): Promise<AdminOrderView> {
    const now = clock.now();
    await runInTransaction(
      async (tx) => {
        const status = await lockOrder(tx, orderId);
        if (!ASSIGNABLE.includes(status)) {
          throw new AppError(
            "ORDER_STATE_INVALID",
            "The carrier can only be changed before the order ships.",
            { details: { status } },
          );
        }
        const company = await tx.shippingCompany.findUnique({
          where: { id: input.shippingCompanyId },
        });
        if (!company) {
          throw validationError("shippingCompanyId", "not_found", "Unknown shipping company.");
        }
        if (company.status !== "ACTIVE") {
          throw validationError("shippingCompanyId", "inactive", "This company is inactive.");
        }
        const order = await tx.order.findUniqueOrThrow({
          where: { id: orderId },
          select: { shippingCompanyId: true },
        });
        await tx.order.update({
          where: { id: orderId },
          data: { shippingCompanyId: company.id, updatedAt: now },
        });
        await recordAudit(tx, {
          actor: employeeActor(actor.employeeId),
          action: "ORDER_SHIPPING_ASSIGNED",
          entityType: AUDIT_ENTITY_TYPES.order,
          entityId: orderId,
          previous: { shippingCompanyId: order.shippingCompanyId },
          next: { shippingCompanyId: company.id },
          correlationId: ctx.correlationId,
          createdAt: now,
        });
      },
      {},
      db,
    );
    ctx.logger.info("order carrier assigned", { orderId });
    return orders().getOrder(orderId, actor.permissions);
  }

  /** `POST /admin/orders/{orderId}/mark-shipped`: the carrier handoff (Q84, R4). */
  async function markShipped(
    actor: OrderActor,
    orderId: string,
    input: MarkShippedInput,
    ctx: Ctx,
  ): Promise<AdminOrderView> {
    const now = clock.now();
    const who = employeeActor(actor.employeeId);
    const shipmentId = await mapTrackingConflict(() =>
      runInTransaction(
        async (tx) => {
          const from = await changeOrderStatus(tx, { orderId, to: "SHIPPED", actor: who, now });
          const order = await tx.order.findUniqueOrThrow({
            where: { id: orderId },
            select: { shippingCompany: true },
          });
          const company = order.shippingCompany;
          if (!company) {
            throw conflict("Assign a shipping company first.", {
              reason: "SHIPPING_COMPANY_REQUIRED",
            });
          }
          if (company.status !== "ACTIVE") {
            throw conflict("The assigned shipping company is inactive.", {
              reason: "SHIPPING_COMPANY_INACTIVE",
            });
          }
          if (input.trackingNumber) {
            await assertTrackingFree(tx, company.id, input.trackingNumber, null);
          }
          await commitForOrder(tx, { orderId, actor: who, now });
          const captured = await captureWalletReservation(tx, { orderId, now });
          if (captured > BigInt(0)) {
            await tx.order.update({
              where: { id: orderId },
              data: { walletAmountCaptured: captured },
            });
          }
          const shipment = await tx.shipment.create({
            data: {
              orderId,
              shippingCompanyId: company.id,
              trackingNumber: input.trackingNumber ?? null,
              status: "SHIPPED",
              pickedUpAt: now,
              createdAt: now,
              updatedAt: now,
              events: { create: [{ eventType: "SHIPPED", eventAt: now }] },
            },
          });
          await recordAudit(tx, {
            actor: who,
            action: "ORDER_SHIPPED",
            entityType: AUDIT_ENTITY_TYPES.order,
            entityId: orderId,
            previous: { status: from },
            next: {
              status: "SHIPPED",
              shipmentId: shipment.id,
              shippingCompanyId: company.id,
              trackingNumber: shipment.trackingNumber,
              walletAmountCaptured: toJsonNumber(captured),
            },
            correlationId: ctx.correlationId,
            createdAt: now,
          });
          await outbox(
            tx,
            "ORDER_SHIPPED",
            orderId,
            { shipmentId: shipment.id, correlationId: ctx.correlationId },
            now,
          );
          return shipment.id;
        },
        {},
        db,
      ),
    );
    ctx.logger.info("order shipped", { orderId, shipmentId });
    return orders().getOrder(orderId, actor.permissions);
  }

  async function loadShipment(id: string): Promise<AdminShipmentView> {
    return toAdminShipment(
      await db.shipment.findUniqueOrThrow({ where: { id }, include: SHIPMENT_INCLUDE }),
    );
  }

  /** Locks the shipment's order, then the shipment; returns its locked state. */
  async function lockShipment(tx: Db, shipmentId: string) {
    const found = await tx.shipment.findUnique({
      where: { id: shipmentId },
      select: { orderId: true },
    });
    if (!found) {
      throw shipmentNotFound();
    }
    await lockOrder(tx, found.orderId);
    const rows = await tx.$queryRaw<
      {
        status: ShipmentStatus;
        trackingNumber: string | null;
        shippingCompanyId: string;
        cancellationRequestedAt: Date | null;
        inspectedAt: Date | null;
      }[]
    >`SELECT status, tracking_number AS "trackingNumber", shipping_company_id AS "shippingCompanyId",
        cancellation_requested_at AS "cancellationRequestedAt", inspected_at AS "inspectedAt"
      FROM shipments WHERE id = ${shipmentId}::uuid FOR UPDATE`;
    return { orderId: found.orderId, ...rows[0] };
  }

  /** `POST /admin/shipments/{shipmentId}/tracking`: add or correct it (audited). */
  async function updateTracking(
    actor: OrderActor,
    shipmentId: string,
    input: UpdateTrackingInput,
    ctx: Ctx,
  ): Promise<AdminShipmentView> {
    const now = clock.now();
    await mapTrackingConflict(() =>
      runInTransaction(
        async (tx) => {
          const shipment = await lockShipment(tx, shipmentId);
          if (shipment.trackingNumber === input.trackingNumber) {
            return;
          }
          await assertTrackingFree(
            tx,
            shipment.shippingCompanyId,
            input.trackingNumber,
            shipmentId,
          );
          await tx.shipment.update({
            where: { id: shipmentId },
            data: {
              trackingNumber: input.trackingNumber,
              updatedAt: now,
              events: { create: [{ eventType: "TRACKING_UPDATED", eventAt: now }] },
            },
          });
          await recordAudit(tx, {
            actor: employeeActor(actor.employeeId),
            action: "SHIPMENT_TRACKING_UPDATED",
            entityType: AUDIT_ENTITY_TYPES.shipment,
            entityId: shipmentId,
            previous: { trackingNumber: shipment.trackingNumber },
            next: { trackingNumber: input.trackingNumber },
            correlationId: ctx.correlationId,
            createdAt: now,
          });
        },
        {},
        db,
      ),
    );
    ctx.logger.info("shipment tracking updated", { shipmentId });
    return loadShipment(shipmentId);
  }

  /** `POST /admin/shipments/{shipmentId}/status` (manual MVP, Q85). */
  async function changeShipmentStatus(
    actor: OrderActor,
    shipmentId: string,
    input: ShipmentStatusInput,
    ctx: Ctx,
  ): Promise<AdminShipmentView> {
    const to = input.status;
    if (to === "DELIVERED" && !actor.permissions.has("MARK_AS_DELIVERED")) {
      throw permissionDenied("Recording a delivery needs MARK_AS_DELIVERED.", {
        requiredPermissions: ["MARK_AS_DELIVERED"],
      });
    }
    const now = clock.now();
    const who = employeeActor(actor.employeeId);
    await runInTransaction(
      async (tx) => {
        const shipment = await lockShipment(tx, shipmentId);
        if (!canMoveShipment(shipment.status, to)) {
          throw conflict(`A shipment in ${shipment.status} cannot move to ${to}.`, {
            reason: "SHIPMENT_STATE_INVALID",
            status: shipment.status,
            to,
          });
        }
        if (needsCancellationRequest(shipment.status, to) && !shipment.cancellationRequestedAt) {
          throw conflict("Request a shipping cancellation first.", {
            reason: "SHIPPING_CANCELLATION_REQUIRED",
            status: shipment.status,
            to,
          });
        }
        const updated = await tx.shipment.update({
          where: { id: shipmentId },
          select: { attemptCount: true },
          data: {
            status: to,
            updatedAt: now,
            ...(to === "DELIVERED" ? { deliveredAt: now } : {}),
            ...(to === "RETURNED" ? { returnedAt: now } : {}),
            ...(to === "DELIVERY_FAILED" ? { attemptCount: { increment: 1 } } : {}),
            events: {
              create: [
                {
                  eventType: to,
                  eventAt: now,
                  location: input.location ?? null,
                  notes: input.notes ?? null,
                },
              ],
            },
          },
        });
        const audits: AuditEntry[] = [
          {
            actor: who,
            action: "SHIPMENT_STATUS_CHANGED",
            entityType: AUDIT_ENTITY_TYPES.shipment,
            entityId: shipmentId,
            previous: { status: shipment.status },
            next: {
              status: to,
              ...(to === "DELIVERY_FAILED" ? { attemptCount: updated.attemptCount } : {}),
            },
            correlationId: ctx.correlationId,
            createdAt: now,
          },
        ];
        if (to === "DELIVERY_FAILED") {
          const taskId = await openContactTaskAtThreshold(tx, {
            orderId: shipment.orderId,
            shipmentId,
            attemptCount: updated.attemptCount,
            now,
            logger: ctx.logger,
          });
          if (taskId) {
            audits.push({
              actor: SYSTEM_ACTOR,
              action: "CONTACT_TASK_CREATED",
              entityType: AUDIT_ENTITY_TYPES.contactTask,
              entityId: taskId,
              next: {
                orderId: shipment.orderId,
                shipmentId,
                reason: "DELIVERY_FAILED_THRESHOLD",
                attemptCount: updated.attemptCount,
              },
              correlationId: ctx.correlationId,
              createdAt: now,
            });
          }
        }
        if (to === "DELIVERED") {
          const from = await changeOrderStatus(tx, {
            orderId: shipment.orderId,
            to: "DELIVERED",
            actor: who,
            now,
            data: { deliveredAt: now },
          });
          audits.push({
            ...audits[0],
            action: "ORDER_DELIVERED",
            entityType: AUDIT_ENTITY_TYPES.order,
            entityId: shipment.orderId,
            previous: { status: from },
            next: { status: "DELIVERED" },
          });
          await outbox(
            tx,
            "ORDER_DELIVERED",
            shipment.orderId,
            { shipmentId, correlationId: ctx.correlationId },
            now,
          );
        }
        await recordAudits(tx, audits);
      },
      {},
      db,
    );
    ctx.logger.info("shipment status changed", { shipmentId, status: to });
    return loadShipment(shipmentId);
  }

  /**
   * `POST /admin/orders/{orderId}/request-shipping-cancellation`
   * (REQUEST_SHIPPING_CANCELLATION, Q88, R3): the order stays `SHIPPED`.
   */
  async function requestShippingCancellation(
    actor: OrderActor,
    orderId: string,
    input: RequestShippingCancellationInput,
    ctx: Ctx,
  ): Promise<AdminOrderView> {
    const now = clock.now();
    const shipmentId = await runInTransaction(
      async (tx) => {
        const status = await lockOrder(tx, orderId);
        if (status !== "SHIPPED") {
          throw new AppError(
            "ORDER_STATE_INVALID",
            "A shipping cancellation can only be requested for a shipped order.",
            { details: { status } },
          );
        }
        return recordShippingCancellationRequest(tx, {
          orderId,
          actor: employeeActor(actor.employeeId),
          reason: input.reason ?? null,
          now,
          correlationId: ctx.correlationId,
        });
      },
      {},
      db,
    );
    ctx.logger.info("shipping cancellation requested", { orderId, shipmentId });
    return orders().getOrder(orderId, actor.permissions);
  }

  /**
   * `POST /admin/shipments/{shipmentId}/inspect-return` (Q130, R3, User Flows
   * §8.4, §10): the returned parcel is inspected for shipping damage and the
   * order moves `SHIPPED → CANCELLED`, in one transaction. Intact units go
   * back to Available and damaged ones to Damaged (`SHIPMENT_RETURN`
   * movements); the discount use is released and captured wallet credit is
   * refunded to the wallet (`ORDER_CANCELLATION_REFUND`, Audit Correction 5).
   */
  async function inspectReturn(
    actor: OrderActor,
    shipmentId: string,
    input: InspectReturnInput,
    ctx: Ctx,
  ): Promise<AdminShipmentView> {
    const now = clock.now();
    const who = employeeActor(actor.employeeId);
    await runInTransaction(
      async (tx) => {
        const shipment = await lockShipment(tx, shipmentId);
        const orderId = shipment.orderId;
        if (shipment.status !== "RETURNED" || shipment.inspectedAt) {
          throw conflict("Only a returned, not yet inspected parcel can be inspected.", {
            reason: "SHIPMENT_STATE_INVALID",
            status: shipment.status,
            inspected: shipment.inspectedAt !== null,
          });
        }
        const order = await tx.order.findUniqueOrThrow({
          where: { id: orderId },
          select: {
            customerId: true,
            walletAmountCaptured: true,
            shippingFee: true,
            items: { select: { id: true, productVariantId: true, quantity: true } },
          },
        });
        const damagedById = new Map(input.damaged.map((d) => [d.orderItemId, d.quantity]));
        input.damaged.forEach((line, index) => {
          const item = order.items.find((i) => i.id === line.orderItemId);
          if (!item) {
            throw validationError(
              `damaged.${index}.orderItemId`,
              "not_found",
              "Not a line of this order.",
            );
          }
          if (line.quantity > item.quantity) {
            throw validationError(
              `damaged.${index}.quantity`,
              "exceeds_quantity",
              "More units than the line has.",
            );
          }
        });
        // Per variant, in variant id order (the balance lock order, ADR-0025).
        const perVariant = new Map<string, { available: number; damaged: number }>();
        for (const item of order.items) {
          const variantId = item.productVariantId.toLowerCase();
          const damaged = damagedById.get(item.id) ?? 0;
          const total = perVariant.get(variantId) ?? { available: 0, damaged: 0 };
          total.available += item.quantity - damaged;
          total.damaged += damaged;
          perVariant.set(variantId, total);
        }
        for (const [variantId, q] of [...perVariant].sort(([a], [b]) => (a < b ? -1 : 1))) {
          await tx.inventoryMovement.create({
            data: {
              productVariantId: variantId,
              movementType: "SHIPMENT_RETURN",
              availableDelta: q.available,
              damagedDelta: q.damaged,
              referenceType: "SHIPMENT",
              referenceId: shipmentId,
              reason: "Returned parcel inspected",
              createdByType: who.type,
              createdById: actor.employeeId,
              createdAt: now,
            },
          });
        }
        await tx.shipment.update({
          where: { id: shipmentId },
          data: {
            inspectedAt: now,
            updatedAt: now,
            events: {
              create: [{ eventType: "RETURN_INSPECTED", eventAt: now, notes: input.notes ?? null }],
            },
          },
        });
        const reason = shipment.cancellationRequestedAt
          ? "Shipping cancellation: parcel returned"
          : "Parcel returned after failed delivery";
        await changeOrderStatus(tx, {
          orderId,
          to: "CANCELLED",
          actor: who,
          now,
          reason,
          data: { cancelledAt: now },
        });
        await releaseOrderHolds(tx, { orderId, actor: who, now, reason: "ORDER_CANCELLED" });
        // A change-of-mind cancellation keeps the shipping fee; a parcel returned
        // after failed delivery refunds everything (owner decision 2026-10-15).
        const shippingFeeKept = shipment.cancellationRequestedAt
          ? minBigInt(order.shippingFee, order.walletAmountCaptured)
          : BigInt(0);
        const refund = order.walletAmountCaptured - shippingFeeKept;
        if (refund > BigInt(0) && order.customerId) {
          await creditWallet(tx, {
            customerId: order.customerId,
            transactionType: "ORDER_CANCELLATION_REFUND",
            amount: refund,
            referenceType: "ORDER",
            referenceId: orderId,
            now,
          });
        }
        const damagedLines = input.damaged.map((d) => ({
          orderItemId: d.orderItemId,
          quantity: d.quantity,
        }));
        await recordAudits(tx, [
          {
            actor: who,
            action: "SHIPMENT_RETURN_INSPECTED",
            entityType: AUDIT_ENTITY_TYPES.shipment,
            entityId: shipmentId,
            next: { damaged: damagedLines, notes: input.notes ?? null },
            correlationId: ctx.correlationId,
            createdAt: now,
          },
          {
            actor: who,
            action: "ORDER_CANCELLED",
            entityType: AUDIT_ENTITY_TYPES.order,
            entityId: orderId,
            previous: { status: "SHIPPED" },
            next: {
              status: "CANCELLED",
              shipmentId,
              walletRefunded: toJsonNumber(refund),
              shippingFeeKept: toJsonNumber(shippingFeeKept),
            },
            reason,
            correlationId: ctx.correlationId,
            createdAt: now,
          },
        ]);
        await outbox(
          tx,
          "ORDER_CANCELLED",
          orderId,
          { cancelledBy: who.type, shipmentId, correlationId: ctx.correlationId },
          now,
        );
      },
      {},
      db,
    );
    ctx.logger.info("returned parcel inspected, order cancelled", { shipmentId });
    return loadShipment(shipmentId);
  }

  return {
    assignShipping,
    markShipped,
    updateTracking,
    changeShipmentStatus,
    requestShippingCancellation,
    inspectReturn,
  };
}

function minBigInt(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

export type ShipmentsService = ReturnType<typeof createShipmentsService>;

let defaultService: ShipmentsService | undefined;

export function getShipmentsService(): ShipmentsService {
  defaultService ??= createShipmentsService({ db: getDb(), clock: systemClock });
  return defaultService;
}
