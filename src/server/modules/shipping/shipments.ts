import type { Prisma, ShipmentEventType, ShipmentStatus } from "@/generated/prisma/client";

/**
 * Shipment state (TASK-034, Business Spec R2, Q85, Q127; User Flows §8.2,
 * §8.3; ADR-0040). Separate from the order state: only `DELIVERED` also
 * moves the order (`SHIPPED → DELIVERED`).
 *
 * TASK-034 implements the delivery path. Delivery failures (TASK-035) and
 * return to sender (TASK-036) add their edges here.
 */
export const SHIPMENT_TRANSITIONS: Readonly<Record<ShipmentStatus, readonly ShipmentStatus[]>> = {
  SHIPPED: ["OUT_FOR_DELIVERY"],
  OUT_FOR_DELIVERY: ["DELIVERED"],
  DELIVERY_FAILED: [],
  RETURN_TO_SENDER: [],
  RETURNED: [],
  DELIVERED: [],
};

export function canMoveShipment(from: ShipmentStatus, to: ShipmentStatus): boolean {
  return SHIPMENT_TRANSITIONS[from].includes(to);
}

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
    events: s.events.map((e) => ({ type: e.eventType, at: e.eventAt.toISOString() })),
  };
}
