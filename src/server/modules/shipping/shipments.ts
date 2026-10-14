import type { Prisma, ShipmentEventType, ShipmentStatus } from "@/generated/prisma/client";

/**
 * Shipment state (TASK-034, Business Spec R2, Q85, Q127; User Flows §8.2,
 * §8.3; ADR-0040). Separate from the order state: only `DELIVERED` also
 * moves the order (`SHIPPED → DELIVERED`).
 *
 * TASK-034 implements the delivery path. TASK-035 adds failed attempts
 * (`OUT_FOR_DELIVERY → DELIVERY_FAILED`, then another attempt; User Flows
 * §10, Q128: a failure never cancels). TASK-036 adds the way back
 * (`→ RETURN_TO_SENDER → RETURNED`, R3, Q89, Q130): after a failed attempt,
 * or from `SHIPPED`/`OUT_FOR_DELIVERY` once a shipping cancellation was
 * requested (`needsCancellationRequest`).
 */
export const SHIPMENT_TRANSITIONS: Readonly<Record<ShipmentStatus, readonly ShipmentStatus[]>> = {
  SHIPPED: ["OUT_FOR_DELIVERY", "RETURN_TO_SENDER"],
  OUT_FOR_DELIVERY: ["DELIVERED", "DELIVERY_FAILED", "RETURN_TO_SENDER"],
  DELIVERY_FAILED: ["OUT_FOR_DELIVERY", "RETURN_TO_SENDER"],
  RETURN_TO_SENDER: ["RETURNED"],
  RETURNED: [],
  DELIVERED: [],
};

export function canMoveShipment(from: ShipmentStatus, to: ShipmentStatus): boolean {
  return SHIPMENT_TRANSITIONS[from].includes(to);
}

/** A parcel not yet failed is only sent back on a shipping cancellation request (R3). */
export function needsCancellationRequest(from: ShipmentStatus, to: ShipmentStatus): boolean {
  return to === "RETURN_TO_SENDER" && from !== "DELIVERY_FAILED";
}

/** The carrier still has the parcel on its way to the customer: a cancellation can be requested. */
export const CANCELLATION_REQUESTABLE: readonly ShipmentStatus[] = [
  "SHIPPED",
  "OUT_FOR_DELIVERY",
  "DELIVERY_FAILED",
];

/** Shipment, company and events, as the order reads load them. */
export const SHIPMENT_INCLUDE = {
  shippingCompany: { select: { id: true, code: true, name: true } },
  events: { orderBy: [{ eventAt: "asc" }, { id: "asc" }] },
} as const satisfies Prisma.ShipmentInclude;

export type ShipmentDetail = Prisma.ShipmentGetPayload<{ include: typeof SHIPMENT_INCLUDE }>;

/** Staff view (`adminOrder.shipments`, shipment endpoints). */
export interface AdminShipmentView {
  id: string;
  orderId: string;
  status: ShipmentStatus;
  company: { id: string; code: string; name: string };
  trackingNumber: string | null;
  shippedAt: string;
  deliveredAt: string | null;
  /** Failed delivery attempts (TASK-035). */
  attemptCount: number;
  /** TASK-036: shipping cancellation requested, back at BeautyFits, inspected. */
  cancellationRequestedAt: string | null;
  returnedAt: string | null;
  inspectedAt: string | null;
  events: {
    id: string;
    type: ShipmentEventType;
    at: string;
    location: string | null;
    notes: string | null;
  }[];
  createdAt: string;
  updatedAt: string;
}

/** Customer tracking (`customerOrder.shipments`): no staff notes. */
export interface CustomerShipmentView {
  status: ShipmentStatus;
  company: { name: string };
  trackingNumber: string | null;
  shippedAt: string;
  deliveredAt: string | null;
  cancellationRequestedAt: string | null;
  returnedAt: string | null;
  events: { type: ShipmentEventType; at: string }[];
}

export function toAdminShipment(s: ShipmentDetail): AdminShipmentView {
  return {
    id: s.id,
    orderId: s.orderId,
    status: s.status,
    company: s.shippingCompany,
    trackingNumber: s.trackingNumber,
    shippedAt: s.pickedUpAt.toISOString(),
    deliveredAt: s.deliveredAt?.toISOString() ?? null,
    attemptCount: s.attemptCount,
    cancellationRequestedAt: s.cancellationRequestedAt?.toISOString() ?? null,
    returnedAt: s.returnedAt?.toISOString() ?? null,
    inspectedAt: s.inspectedAt?.toISOString() ?? null,
    events: s.events.map((e) => ({
      id: e.id,
      type: e.eventType,
      at: e.eventAt.toISOString(),
      location: e.location,
      notes: e.notes,
    })),
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

export function toCustomerShipment(s: ShipmentDetail): CustomerShipmentView {
  return {
    status: s.status,
    company: { name: s.shippingCompany.name },
    trackingNumber: s.trackingNumber,
    shippedAt: s.pickedUpAt.toISOString(),
    deliveredAt: s.deliveredAt?.toISOString() ?? null,
    cancellationRequestedAt: s.cancellationRequestedAt?.toISOString() ?? null,
    returnedAt: s.returnedAt?.toISOString() ?? null,
    events: s.events.map((e) => ({ type: e.eventType, at: e.eventAt.toISOString() })),
  };
}
