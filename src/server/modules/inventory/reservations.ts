import type { InventoryMovementType } from "@/generated/prisma/client";
import type { Db } from "@/server/db/transaction";
import { AppError } from "@/server/errors/app-error";
import type { AuditActor } from "@/server/modules/audit/audit";
import { conflict } from "@/server/modules/catalog/errors";
import { variantNotFound } from "@/server/modules/catalog/product-guards";

/**
 * Inventory reservation engine (TASK-020, Business Spec Q9, Q25, Q28, R11;
 * User Flows §13.2–13.3; ADR-0025).
 *
 * Callers (checkout, COD expiry, cancellation, shipping) run these inside
 * their own transaction, so the order and its stock hold commit together.
 *
 * - `reserveForOrder` moves Available → Reserved for every line, all or
 *   nothing (`STOCK_CHANGED` when any line is short).
 * - `releaseForOrder` gives an order's holds back to Available (cancelled or
 *   expired order).
 * - `commitForOrder` consumes an order's holds when it ships (ADR-0025 §3).
 *
 * Each step writes one inventory movement per variant (reference ORDER /
 * order id); the movement trigger updates the balance and its check is the
 * last line against overselling. Balances are locked in variant id order so
 * concurrent orders never deadlock. Release and commit do nothing when the
 * order holds nothing, so retries are safe.
 */

export const ORDER_REFERENCE_TYPE = "ORDER";

export interface ReservationLine {
  variantId: string;
  quantity: number;
}

export interface ReservationView {
  id: string;
  orderId: string;
  variantId: string;
  quantity: number;
  status: "ACTIVE" | "RELEASED" | "CONVERTED";
}

interface MoveContext {
  orderId: string;
  actor: AuditActor;
  now: Date;
  reason?: string | null;
}

/** Sums the quantities per variant, sorted by variant id (the lock order). */
export function mergeLines(lines: readonly ReservationLine[]): ReservationLine[] {
  if (lines.length === 0) {
    throw new RangeError("A reservation needs at least one line");
  }
  const totals = new Map<string, number>();
  for (const line of lines) {
    if (!Number.isSafeInteger(line.quantity) || line.quantity <= 0) {
      throw new RangeError(`Invalid reservation quantity ${line.quantity}`);
    }
    // Lowercase: the sort below then matches PostgreSQL's uuid order.
    const variantId = line.variantId.toLowerCase();
    totals.set(variantId, (totals.get(variantId) ?? 0) + line.quantity);
  }
  return [...totals]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([variantId, quantity]) => ({ variantId, quantity }));
}

/** The lines that ask for more than is available. */
export function shortLines(
  lines: readonly ReservationLine[],
  available: ReadonlyMap<string, number>,
): ReservationLine[] {
  return lines.filter((line) => (available.get(line.variantId) ?? 0) < line.quantity);
}

async function writeMovements(
  tx: Db,
  type: InventoryMovementType,
  lines: readonly ReservationLine[],
  deltas: (quantity: number) => { availableDelta: number; reservedDelta: number },
  context: MoveContext,
): Promise<void> {
  // One by one, in the order given (variant id order): each insert updates
  // and locks a balance row through the trigger.
  for (const line of lines) {
    await tx.inventoryMovement.create({
      data: {
        productVariantId: line.variantId,
        movementType: type,
        ...deltas(line.quantity),
        referenceType: ORDER_REFERENCE_TYPE,
        referenceId: context.orderId,
        reason: context.reason ?? null,
        createdByType: context.actor.type,
        createdById: context.actor.type === "SYSTEM" ? null : (context.actor.id ?? null),
        createdAt: context.now,
      },
    });
  }
}

/**
 * Holds stock for an order. An order reserves once; changing its lines
 * (TASK-032) releases and reserves again.
 */
export async function reserveForOrder(
  tx: Db,
  input: { orderId: string; lines: readonly ReservationLine[]; actor: AuditActor; now: Date },
): Promise<ReservationView[]> {
  const lines = mergeLines(input.lines);
  const ids = lines.map((line) => line.variantId);
  const locked = await tx.$queryRaw<{ id: string; available: number }[]>`
    SELECT product_variant_id AS id, available_quantity AS available
    FROM inventory_balances
    WHERE product_variant_id = ANY(${ids}::uuid[])
    ORDER BY product_variant_id
    FOR UPDATE`;
  if (locked.length !== ids.length) {
    throw variantNotFound();
  }
  const held = await tx.inventoryReservation.count({
    where: { orderId: input.orderId, status: "ACTIVE" },
  });
  if (held > 0) {
    throw conflict("This order already holds stock.", { reason: "ORDER_ALREADY_RESERVED" });
  }
  const short = shortLines(lines, new Map(locked.map((row) => [row.id, row.available])));
  if (short.length > 0) {
    // Only which variants are short: stock counts are not shown to customers.
    throw new AppError(
      "STOCK_CHANGED",
      "One or more items are no longer available at the requested quantity.",
      { details: { items: short.map((line) => ({ variantId: line.variantId })) } },
    );
  }
  await writeMovements(
    tx,
    "RESERVATION",
    lines,
    (quantity) => ({ availableDelta: -quantity, reservedDelta: quantity }),
    input,
  );
  await tx.inventoryReservation.createMany({
    data: lines.map((line) => ({
      orderId: input.orderId,
      productVariantId: line.variantId,
      quantity: line.quantity,
      reservedAt: input.now,
    })),
  });
  return listReservations(tx, input.orderId, "ACTIVE");
}

/** Ends an order's active holds: released to Available, or consumed at shipping. */
async function settle(
  tx: Db,
  outcome: "RELEASED" | "CONVERTED",
  context: MoveContext,
): Promise<ReservationView[]> {
  // Locking the active rows makes a concurrent second release/commit wait
  // and then find nothing to do.
  const active = await tx.$queryRaw<{ id: string; variantId: string; quantity: number }[]>`
    SELECT id, product_variant_id AS "variantId", quantity
    FROM inventory_reservations
    WHERE order_id = ${context.orderId}::uuid AND status = 'ACTIVE'
    ORDER BY product_variant_id
    FOR UPDATE`;
  if (active.length === 0) {
    return [];
  }
  if (outcome === "RELEASED") {
    await writeMovements(
      tx,
      "RELEASE_RESERVATION",
      active,
      (quantity) => ({ availableDelta: quantity, reservedDelta: -quantity }),
      context,
    );
  } else {
    await writeMovements(
      tx,
      "CUSTOMER_ORDER_COMMIT",
      active,
      (quantity) => ({ availableDelta: 0, reservedDelta: -quantity }),
      context,
    );
  }
  await tx.inventoryReservation.updateMany({
    where: { id: { in: active.map((row) => row.id) } },
    data:
      outcome === "RELEASED"
        ? { status: "RELEASED", releasedAt: context.now }
        : { status: "CONVERTED", convertedAt: context.now },
  });
  return active.map((row) => ({
    id: row.id,
    orderId: context.orderId,
    variantId: row.variantId,
    quantity: row.quantity,
    status: outcome,
  }));
}

/** Cancelled or expired order (Q25, Q28, R11): its stock goes back to Available. */
export function releaseForOrder(tx: Db, context: MoveContext): Promise<ReservationView[]> {
  return settle(tx, "RELEASED", context);
}

/** The order shipped (ADR-0025 §3): its held stock leaves the warehouse. */
export function commitForOrder(tx: Db, context: MoveContext): Promise<ReservationView[]> {
  return settle(tx, "CONVERTED", context);
}

export async function listReservations(
  db: Db,
  orderId: string,
  status?: ReservationView["status"],
): Promise<ReservationView[]> {
  const rows = await db.inventoryReservation.findMany({
    where: { orderId, ...(status ? { status } : {}) },
    orderBy: [{ productVariantId: "asc" }, { reservedAt: "asc" }],
  });
  return rows.map((row) => ({
    id: row.id,
    orderId: row.orderId,
    variantId: row.productVariantId,
    quantity: row.quantity,
    status: row.status,
  }));
}
