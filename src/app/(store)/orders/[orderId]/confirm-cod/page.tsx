import type { Metadata } from "next";
import { ConfirmCod } from "./confirm-cod";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

/**
 * Target of the WhatsApp COD link (API "TASK-045 Amendments"):
 * `/orders/{orderId}/confirm-cod#token=bfo_…`. No sign-in (guests too, R16).
 */
export default async function ConfirmCodPage({
  params,
}: PageProps<"/orders/[orderId]/confirm-cod">) {
  const { orderId } = await params;
  return <ConfirmCod orderId={orderId} />;
}
