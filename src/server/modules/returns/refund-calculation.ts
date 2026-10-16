import type { Db } from "@/server/db/transaction";
import { RELEASED_RETURN_STATUSES } from "@/server/modules/returns/returns";
import {
  calculateRefund,
  finalPickupFeePayer,
  type RefundCalculation,
} from "@/server/modules/returns/refunds";

/**
 * Reads a return and calculates its refund (TASK-040, ADR-0066). TASK-041
 * calls this inside the completion transaction, after locking the return,
 * and credits the wallet with `totalRefund`.
 */

export interface ReturnRefund extends RefundCalculation {
  returnId: string;
  finalResponsibility: string;
  lines: (RefundCalculation["lines"][number] & {
    orderItemId: string;
    resolution: string | null;
  })[];
  /**
   * The pickup fee (C2). Who was told to pay at pickup, who should pay after
   * the assessment, and whether they differ. Any settlement of a difference
   * is not decided and is not part of `totalRefund` (ADR-0066).
   */
  pickupFee: {
    provisionalPayer: string | null;
    finalPayer: string | null;
    amount: bigint | null;
    payerChanged: boolean;
  };
}

/** Null when the return does not exist. */
export async function loadReturnRefund(db: Db, returnId: string): Promise<ReturnRefund | null> {
  const row = await db.return.findUnique({
    where: { id: returnId },
    select: {
      id: true,
      orderId: true,
      createdAt: true,
      finalResponsibility: true,
      assessedAt: true,
      pickupFeePayer: true,
      returnShippingFee: true,
      order: { select: { shippingFee: true } },
      items: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          orderItemId: true,
          requestedQuantity: true,
          customerCausedResolution: true,
          resolutionBasisPoints: true,
          orderItem: { select: { quantity: true, lineTotal: true } },
          inspections: { select: { result: true, quantity: true } },
        },
      },
    },
  });
  if (!row) {
    return null;
  }
  const live = { status: { notIn: [...RELEASED_RETURN_STATUSES] }, id: { not: row.id } };
  const earlier = {
    OR: [{ createdAt: { lt: row.createdAt } }, { createdAt: row.createdAt, id: { lt: row.id } }],
  };
  // Units of the same order lines in earlier live returns (cumulative shares).
  const prior = await db.returnItem.groupBy({
    by: ["orderItemId"],
    where: {
      orderItemId: { in: row.items.map((i) => i.orderItemId) },
      return: { ...live, ...earlier },
    },
    _sum: { requestedQuantity: true },
  });
  const priorByLine = new Map(prior.map((p) => [p.orderItemId, p._sum.requestedQuantity ?? 0]));
  // C3: the delivery fee goes back once per order, with the first return
  // assessed as BeautyFits' or the carrier's fault.
  const feeTaken =
    row.assessedAt !== null &&
    (await db.return.count({
      where: {
        ...live,
        orderId: row.orderId,
        finalResponsibility: { in: ["BEAUTYFITS", "CARRIER"] },
        OR: [
          { assessedAt: { lt: row.assessedAt } },
          { assessedAt: row.assessedAt, id: { lt: row.id } },
        ],
      },
    })) > 0;

  const calculation = calculateRefund({
    responsibility: row.finalResponsibility,
    orderShippingFee: row.order.shippingFee,
    deliveryFeeTakenElsewhere: feeTaken,
    lines: row.items.map((item) => ({
      returnItemId: item.id,
      orderedQuantity: item.orderItem.quantity,
      lineTotal: item.orderItem.lineTotal,
      priorQuantity: priorByLine.get(item.orderItemId) ?? 0,
      quantity: item.requestedQuantity,
      outcomes: item.inspections,
      resolution: item.customerCausedResolution
        ? {
            resolution: item.customerCausedResolution,
            basisPoints: item.resolutionBasisPoints,
          }
        : null,
    })),
  });
  const finalPayer = finalPickupFeePayer(row.finalResponsibility);
  return {
    ...calculation,
    returnId: row.id,
    finalResponsibility: row.finalResponsibility,
    lines: calculation.lines.map((line, index) => ({
      ...line,
      orderItemId: row.items[index].orderItemId,
      resolution: row.items[index].customerCausedResolution,
    })),
    pickupFee: {
      provisionalPayer: row.pickupFeePayer,
      finalPayer,
      amount: row.returnShippingFee,
      payerChanged:
        finalPayer !== null && row.pickupFeePayer !== null && finalPayer !== row.pickupFeePayer,
    },
  };
}
