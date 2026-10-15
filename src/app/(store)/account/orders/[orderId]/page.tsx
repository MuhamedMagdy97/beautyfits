import type { Metadata } from "next";
import { OrderDetail } from "./order-detail";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/** One of the customer's orders (TASK-060). */
export default async function OrderPage({ params }: PageProps<"/account/orders/[orderId]">) {
  const { orderId } = await params;
  return <OrderDetail orderId={orderId} />;
}
