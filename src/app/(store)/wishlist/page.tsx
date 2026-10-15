import type { Metadata } from "next";
import { WishlistView } from "./wishlist-view";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function WishlistPage() {
  return <WishlistView />;
}
