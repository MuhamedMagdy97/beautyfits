import type { Locale } from "@/generated/prisma/client";
import type { Db } from "@/server/db/transaction";

export interface OrderContacts {
  orderId: string;
  orderNumber: string;
  locale: Locale;
  customerId: string | null;
  /** WhatsApp address: the customer's profile phone, or the guest's. */
  phone: string | null;
  /** Authorized email: the customer's verified account email, or the guest's. */
  email: string | null;
}

/**
 * Where to send messages about an order (TASK-045, ADR-0043 §3). `null` when
 * the order does not exist or its customer deactivated the account (Q154).
 */
export async function orderContacts(db: Db, orderId: string): Promise<OrderContacts | null> {
  const order = await db.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      orderNumber: true,
      locale: true,
      customerId: true,
      guestPhone: true,
      guestEmail: true,
      customer: {
        select: {
          phone: true,
          anonymizedAt: true,
          account: { select: { email: true, emailVerifiedAt: true } },
        },
      },
    },
  });
  if (!order || order.customer?.anonymizedAt) {
    return null;
  }
  const base = {
    orderId: order.id,
    orderNumber: order.orderNumber,
    locale: order.locale,
    customerId: order.customerId,
  };
  if (!order.customer) {
    return { ...base, phone: order.guestPhone, email: order.guestEmail };
  }
  const account = order.customer.account;
  return {
    ...base,
    phone: order.customer.phone,
    email: account?.emailVerifiedAt ? account.email : null,
  };
}
