import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/server/db/client";
import { runInTransaction } from "@/server/db/transaction";
import { AppError } from "@/server/errors/app-error";
import { SYSTEM_ACTOR } from "@/server/modules/audit/audit";
import {
  commitForOrder,
  releaseForOrder,
  reserveForOrder,
  type ReservationLine,
} from "@/server/modules/inventory/reservations";
import { resetDatabase } from "@/test/integration/database";

/** The reservation engine against PostgreSQL (TASK-020, Q9, Q28, ADR-0025). */

const db = getDb();
let counter = 0;

/** A variant with `available` units in stock. */
async function variantWith(available: number): Promise<string> {
  counter += 1;
  const product = await db.product.create({
    data: {
      nameAr: "منتج",
      nameEn: `Product ${counter}`,
      slug: `product-${counter}`,
      variants: { create: { sku: `SKU-${counter}`, isDefault: true } },
    },
    include: { variants: true },
  });
  const variantId = product.variants[0].id;
  if (available > 0) {
    await db.inventoryMovement.create({
      data: {
        productVariantId: variantId,
        movementType: "MANUAL_ADJUSTMENT",
        availableDelta: available,
        reason: "Opening stock",
        createdByType: "SYSTEM",
      },
    });
  }
  return variantId;
}

async function stock(variantId: string) {
  const balance = await db.inventoryBalance.findUniqueOrThrow({
    where: { productVariantId: variantId },
  });
  return {
    available: balance.availableQuantity,
    reserved: balance.reservedQuantity,
    damaged: balance.damagedQuantity,
  };
}

function reserve(orderId: string, lines: ReservationLine[]) {
  return runInTransaction(
    (tx) => reserveForOrder(tx, { orderId, lines, actor: SYSTEM_ACTOR, now: new Date() }),
    {},
    db,
  );
}

function release(orderId: string) {
  return runInTransaction(
    (tx) =>
      releaseForOrder(tx, { orderId, actor: SYSTEM_ACTOR, now: new Date(), reason: "Expired" }),
    {},
    db,
  );
}

function commit(orderId: string) {
  return runInTransaction(
    (tx) => commitForOrder(tx, { orderId, actor: SYSTEM_ACTOR, now: new Date() }),
    {},
    db,
  );
}

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await db.$disconnect();
});

describe("reserve", () => {
  it("moves Available to Reserved with one movement per variant", async () => {
    const lipstick = await variantWith(5);
    const mascara = await variantWith(2);
    const orderId = randomUUID();
    const held = await reserve(orderId, [
      { variantId: lipstick, quantity: 1 },
      { variantId: mascara, quantity: 2 },
      { variantId: lipstick, quantity: 2 },
    ]);
    expect(held.map((r) => [r.variantId, r.quantity, r.status]).sort()).toEqual(
      [
        [lipstick, 3, "ACTIVE"],
        [mascara, 2, "ACTIVE"],
      ].sort(),
    );
    expect(await stock(lipstick)).toEqual({ available: 2, reserved: 3, damaged: 0 });
    expect(await stock(mascara)).toEqual({ available: 0, reserved: 2, damaged: 0 });
    const movements = await db.inventoryMovement.findMany({
      where: { movementType: "RESERVATION" },
    });
    expect(movements).toHaveLength(2);
    expect(movements[0]).toMatchObject({ referenceType: "ORDER", referenceId: orderId });
  });

  it("is all or nothing: one short line refuses the whole order", async () => {
    const plenty = await variantWith(10);
    const scarce = await variantWith(1);
    const error = await reserve(randomUUID(), [
      { variantId: plenty, quantity: 1 },
      { variantId: scarce, quantity: 2 },
    ]).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({
      code: "STOCK_CHANGED",
      details: { items: [{ variantId: scarce }] },
    });
    expect(await stock(plenty)).toEqual({ available: 10, reserved: 0, damaged: 0 });
    expect(await db.inventoryMovement.count({ where: { movementType: "RESERVATION" } })).toBe(0);
    expect(await db.inventoryReservation.count()).toBe(0);
  });

  it("refuses unknown variants and a second reservation of the same order", async () => {
    const variant = await variantWith(5);
    await expect(
      reserve(randomUUID(), [{ variantId: randomUUID(), quantity: 1 }]),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const orderId = randomUUID();
    await reserve(orderId, [{ variantId: variant, quantity: 1 }]);
    await expect(reserve(orderId, [{ variantId: variant, quantity: 1 }])).rejects.toMatchObject({
      code: "CONFLICT",
      details: { reason: "ORDER_ALREADY_RESERVED" },
    });
    expect(await stock(variant)).toEqual({ available: 4, reserved: 1, damaged: 0 });
  });
});

describe("release and commit", () => {
  it("releases back to Available once; retries do nothing", async () => {
    const variant = await variantWith(3);
    const orderId = randomUUID();
    await reserve(orderId, [{ variantId: variant, quantity: 2 }]);
    expect((await release(orderId)).map((r) => r.status)).toEqual(["RELEASED"]);
    expect(await release(orderId)).toEqual([]);
    expect(await stock(variant)).toEqual({ available: 3, reserved: 0, damaged: 0 });
    const reservation = await db.inventoryReservation.findFirstOrThrow({ where: { orderId } });
    expect(reservation.status).toBe("RELEASED");
    expect(reservation.releasedAt).not.toBeNull();
    const movement = await db.inventoryMovement.findFirstOrThrow({
      where: { movementType: "RELEASE_RESERVATION" },
    });
    expect(movement).toMatchObject({ availableDelta: 2, reservedDelta: -2, reason: "Expired" });
  });

  it("consumes Reserved at shipping; a later release does nothing", async () => {
    const variant = await variantWith(3);
    const orderId = randomUUID();
    await reserve(orderId, [{ variantId: variant, quantity: 2 }]);
    expect((await commit(orderId)).map((r) => r.status)).toEqual(["CONVERTED"]);
    expect(await commit(orderId)).toEqual([]);
    expect(await release(orderId)).toEqual([]);
    expect(await stock(variant)).toEqual({ available: 1, reserved: 0, damaged: 0 });
    // The balance is still the sum of the ledger.
    const sums = await db.inventoryMovement.aggregate({
      where: { productVariantId: variant },
      _sum: { availableDelta: true, reservedDelta: true },
    });
    expect(sums._sum).toEqual({ availableDelta: 1, reservedDelta: 0 });
  });

  it("lets an order reserve again after its hold was released (order edits)", async () => {
    const variant = await variantWith(3);
    const orderId = randomUUID();
    await reserve(orderId, [{ variantId: variant, quantity: 1 }]);
    await release(orderId);
    await reserve(orderId, [{ variantId: variant, quantity: 3 }]);
    expect(await stock(variant)).toEqual({ available: 0, reserved: 3, damaged: 0 });
  });

  it("keeps reservation history: final reservations never change, none is deleted", async () => {
    const variant = await variantWith(2);
    const orderId = randomUUID();
    const [held] = await reserve(orderId, [{ variantId: variant, quantity: 1 }]);
    await expect(
      db.inventoryReservation.update({ where: { id: held.id }, data: { quantity: 2 } }),
    ).rejects.toThrow();
    await commit(orderId);
    await expect(
      db.inventoryReservation.update({
        where: { id: held.id },
        data: { status: "RELEASED", convertedAt: null, releasedAt: new Date() },
      }),
    ).rejects.toThrow();
    await expect(db.inventoryReservation.delete({ where: { id: held.id } })).rejects.toThrow();
  });
});

describe("concurrency", () => {
  it("never oversells the last units", async () => {
    const variant = await variantWith(3);
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        reserve(randomUUID(), [{ variantId: variant, quantity: 1 }]),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(3);
    for (const failed of results.filter((r) => r.status === "rejected")) {
      expect((failed as PromiseRejectedResult).reason).toMatchObject({ code: "STOCK_CHANGED" });
    }
    expect(await stock(variant)).toEqual({ available: 0, reserved: 3, damaged: 0 });
    expect(await db.inventoryReservation.count()).toBe(3);
  });

  it("does not deadlock when orders list the same variants in opposite order", async () => {
    const a = await variantWith(50);
    const b = await variantWith(50);
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, (_, i) =>
        reserve(
          randomUUID(),
          i % 2 === 0
            ? [
                { variantId: a, quantity: 1 },
                { variantId: b, quantity: 1 },
              ]
            : [
                { variantId: b, quantity: 1 },
                { variantId: a, quantity: 1 },
              ],
        ),
      ),
    );
    expect(results.filter((r) => r.status === "rejected")).toEqual([]);
    expect(await stock(a)).toEqual({ available: 30, reserved: 20, damaged: 0 });
    expect(await stock(b)).toEqual({ available: 30, reserved: 20, damaged: 0 });
  });

  it("releases an order only once under concurrent retries", async () => {
    const variant = await variantWith(4);
    const orderId = randomUUID();
    await reserve(orderId, [{ variantId: variant, quantity: 4 }]);
    const results = await Promise.all(Array.from({ length: 5 }, () => release(orderId)));
    expect(results.filter((released) => released.length > 0)).toHaveLength(1);
    expect(await stock(variant)).toEqual({ available: 4, reserved: 0, damaged: 0 });
  });
});
