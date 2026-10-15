import { Deliveries } from "./deliveries";

/** `/staff/notifications?orderId={id}`: an order screen can link to its messages. */
export default async function NotificationsPage({
  searchParams,
}: PageProps<"/staff/notifications">) {
  const { orderId } = await searchParams;
  return <Deliveries initialOrderId={typeof orderId === "string" ? orderId : ""} />;
}
