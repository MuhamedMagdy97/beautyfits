import { getDb } from "@/server/db/client";

let counter = 0;

/**
 * A minimal guest order, for tests of the engines that hold resources for an
 * order (reservations, discount uses, wallet holds) without going through
 * checkout. Test-only.
 */
export async function bareOrder(customerId: string | null = null): Promise<string> {
  counter += 1;
  const now = new Date();
  const order = await getDb().order.create({
    data: {
      orderNumber: `BF-T${counter}-${now.getTime()}`,
      customerId,
      guestPhone: customerId ? null : "+201000000000",
      status: "PENDING_CONFIRMATION",
      locale: "en",
      subtotal: BigInt(10000),
      discountTotal: BigInt(0),
      shippingFee: BigInt(0),
      total: BigInt(10000),
      walletAmountReserved: BigInt(0),
      codAmount: BigInt(10000),
      shippingRuleSnapshot: {},
      shippingAddressSnapshot: {},
      customerSnapshot: { customerId, fullName: "Test", phone: "+201000000000" },
      codConfirmationDeadlineAt: new Date(now.getTime() + 72 * 60 * 60 * 1000),
      createdAt: now,
      updatedAt: now,
    },
  });
  return order.id;
}

export function bareOrders(count: number): Promise<string[]> {
  return Promise.all(Array.from({ length: count }, () => bareOrder()));
}
