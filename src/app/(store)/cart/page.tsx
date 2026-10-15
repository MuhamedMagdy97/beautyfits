import type { Metadata } from "next";
import { CartView } from "./cart-view";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function CartPage() {
  return <CartView />;
}
