import type { Metadata } from "next";
import { OrderList } from "./order-list";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/** The customer's orders (TASK-060): `/account/orders?page=`. */
export default async function OrdersPage({ searchParams }: PageProps<"/account/orders">) {
  const { page } = await searchParams;
  return <OrderList page={Math.max(1, Number.parseInt(String(page ?? ""), 10) || 1)} />;
}
