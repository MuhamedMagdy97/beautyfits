import type { OrderRevisionStatus, OrderStatus } from "@/generated/prisma/client";
import { MS_PER_HOUR } from "@/server/time/time";

/**
 * Order revisions: the pure parts (TASK-032; Business Spec C5, Q32, R40;
 * ADR-0038). The service is `revisions-service.ts`.
 */

/** Orders can be changed before Preparing (Q32). */
export const EDITABLE_ORDER_STATUSES: readonly OrderStatus[] = [
  "PENDING_CONFIRMATION",
  "NEW",
  "CONFIRMED",
];

/** An unconfirmed revision lapses after 24 hours (R40). */
export const REVISION_LIFETIME_MS = 24 * MS_PER_HOUR;

export interface HeldLine {
  variantId: string;
  unitPrice: bigint;
  quantity: number;
}

export interface PlannedLine extends HeldLine {
  /** True when this quantity was already in the order at this price. */
  fromOrder: boolean;
}

/**
 * The lines of the revised order (R40): quantity the order already had keeps
 * its order price (the cheapest held price first); extra quantity and new
 * items take today's price. Variants left out are removed. Returns the
 * variants whose extra quantity cannot be bought now instead.
 */
export function planLines(
  held: readonly HeldLine[],
  requested: readonly { variantId: string; quantity: number }[],
  todayPrice: ReadonlyMap<string, bigint | null>,
): { ok: true; lines: PlannedLine[] } | { ok: false; unavailable: string[] } {
  const lines: PlannedLine[] = [];
  const unavailable: string[] = [];
  for (const { variantId, quantity } of requested) {
    let left = quantity;
    const own = held
      .filter((line) => line.variantId === variantId)
      .sort((a, b) => (a.unitPrice < b.unitPrice ? -1 : a.unitPrice > b.unitPrice ? 1 : 0));
    for (const line of own) {
      if (left === 0) break;
      const take = Math.min(left, line.quantity);
      lines.push({ variantId, unitPrice: line.unitPrice, quantity: take, fromOrder: true });
      left -= take;
    }
    if (left === 0) continue;
    const price = todayPrice.get(variantId) ?? null;
    if (price === null) {
      unavailable.push(variantId);
      continue;
    }
    const same = lines.find((line) => line.variantId === variantId && line.unitPrice === price);
    if (same) {
      same.quantity += left;
    } else {
      lines.push({ variantId, unitPrice: price, quantity: left, fromOrder: false });
    }
  }
  return unavailable.length > 0 ? { ok: false, unavailable } : { ok: true, lines };
}

/** What the customer sees: a lapsed or blocked revision shows as EXPIRED. */
export function effectiveRevisionStatus(
  revision: { status: OrderRevisionStatus; expiresAt: Date },
  orderStatus: OrderStatus,
  now: Date,
): OrderRevisionStatus {
  if (
    revision.status === "PENDING_CONFIRMATION" &&
    (revision.expiresAt <= now || !EDITABLE_ORDER_STATUSES.includes(orderStatus))
  ) {
    return "EXPIRED";
  }
  return revision.status;
}

/** JSON with sorted keys, so stored (JSONB) and fresh snapshots compare equal. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );
}

type Json = Record<string, unknown>;

/** A revision as shown to its customer (API "TASK-032 Amendments"); no costs. */
export interface RevisionView {
  id: string;
  revisionNumber: number;
  status: OrderRevisionStatus;
  oldTotal: number;
  newTotal: number;
  expiresAt: string;
  createdAt: string;
  confirmedAt: string | null;
  proposed: {
    items: {
      variantId: string;
      sku: string;
      name: string;
      variantName: string | null;
      quantity: number;
      unitPrice: number;
      discountAmount: number;
      lineTotal: number;
    }[];
    subtotal: number;
    discountTotal: number;
    discountDropped: boolean;
    shippingFee: number;
    freeShipping: boolean;
    total: number;
    walletAmount: number;
    codAmount: number;
    shippingAddress: unknown;
  };
}

export function toRevisionView(
  revision: {
    id: string;
    revisionNumber: number;
    status: OrderRevisionStatus;
    oldTotal: bigint;
    newTotal: bigint;
    proposedSnapshot: unknown;
    expiresAt: Date;
    createdAt: Date;
    confirmedAt: Date | null;
  },
  orderStatus: OrderStatus,
  locale: "ar" | "en",
  now: Date,
): RevisionView {
  const p = revision.proposedSnapshot as Json;
  const local = (value: unknown) =>
    value === null ? null : ((value as Record<string, string | null>)[locale] ?? null);
  return {
    id: revision.id,
    revisionNumber: revision.revisionNumber,
    status: effectiveRevisionStatus(revision, orderStatus, now),
    oldTotal: Number(revision.oldTotal),
    newTotal: Number(revision.newTotal),
    expiresAt: revision.expiresAt.toISOString(),
    createdAt: revision.createdAt.toISOString(),
    confirmedAt: revision.confirmedAt?.toISOString() ?? null,
    proposed: {
      items: (p.items as Json[]).map((i) => ({
        variantId: i.variantId as string,
        sku: i.sku as string,
        name: local(i.name) ?? "",
        variantName: local(i.variantName),
        quantity: i.quantity as number,
        unitPrice: i.unitPrice as number,
        discountAmount: i.discountAmount as number,
        lineTotal: i.lineTotal as number,
      })),
      subtotal: p.subtotal as number,
      discountTotal: p.discountTotal as number,
      discountDropped: p.discountDropped as boolean,
      shippingFee: p.shippingFee as number,
      freeShipping: p.freeShipping as boolean,
      total: p.total as number,
      walletAmount: p.walletAmount as number,
      codAmount: p.codAmount as number,
      shippingAddress: p.shippingAddress,
    },
  };
}
