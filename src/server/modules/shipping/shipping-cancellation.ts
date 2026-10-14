import type { ShipmentStatus } from "@/generated/prisma/client";
import type { Db } from "@/server/db/transaction";
import { AUDIT_ENTITY_TYPES, recordAudit, type AuditActor } from "@/server/modules/audit/audit";
import { conflict } from "@/server/modules/catalog/errors";
import { CANCELLATION_REQUESTABLE } from "@/server/modules/shipping/shipments";

/**
 * Records a shipping cancellation request on a shipped order's shipment
 * (TASK-036, Business Spec Q10, Q33, Q88, Q89, R3, R11; User Flows §8.4;
 * ADR-0048). It is a request, not a cancellation: the order stays
 * `SHIPPED`, the shipment gets `cancellation_requested_at` and a
 * `SHIPPING_CANCELLATION_REQUESTED` event; staff then ask the carrier to
 * bring the parcel back (`RETURN_TO_SENDER`).
 *
 * Runs in the caller's transaction, after the caller locked the order and
 * checked it is `SHIPPED`. Used by the customer `cancel` of a shipped order
 * and by `request-shipping-cancellation` (REQUEST_SHIPPING_CANCELLATION).
 */
export async function recordShippingCancellationRequest(
  tx: Db,
  input: {
    orderId: string;
    actor: AuditActor;
    reason: string | null;
    now: Date;
    correlationId: string | null;
  },
): Promise<string> {
  const { orderId, actor, reason, now } = input;
  const rows = await tx.$queryRaw<
    { id: string; status: ShipmentStatus; cancellationRequestedAt: Date | null }[]
  >`SELECT id, status, cancellation_requested_at AS "cancellationRequestedAt"
    FROM shipments WHERE order_id = ${orderId}::uuid
    ORDER BY created_at DESC, id DESC FOR UPDATE`;
  const shipment = rows.find((row) => CANCELLATION_REQUESTABLE.includes(row.status));
  if (!shipment) {
    throw conflict("The parcel is no longer on its way to the customer.", {
      reason: "SHIPMENT_STATE_INVALID",
      status: rows[0]?.status ?? null,
    });
  }
  if (shipment.cancellationRequestedAt) {
    throw conflict("A shipping cancellation was already requested.", {
      reason: "SHIPPING_CANCELLATION_ALREADY_REQUESTED",
    });
  }
  await tx.shipment.update({
    where: { id: shipment.id },
    data: {
      cancellationRequestedAt: now,
      updatedAt: now,
      events: {
        create: [{ eventType: "SHIPPING_CANCELLATION_REQUESTED", eventAt: now, notes: reason }],
      },
    },
  });
  await recordAudit(tx, {
    actor,
    action: "SHIPPING_CANCELLATION_REQUESTED",
    entityType: AUDIT_ENTITY_TYPES.shipment,
    entityId: shipment.id,
    previous: { status: shipment.status },
    next: { orderId, cancellationRequestedAt: now.toISOString() },
    reason,
    correlationId: input.correlationId,
    createdAt: now,
  });
  await tx.outboxEvent.create({
    data: {
      eventType: "SHIPPING_CANCELLATION_REQUESTED",
      aggregateType: "ORDER",
      aggregateId: orderId,
      payload: {
        orderId,
        shipmentId: shipment.id,
        requestedBy: actor.type,
        correlationId: input.correlationId,
      },
      availableAt: now,
      createdAt: now,
    },
  });
  return shipment.id;
}
