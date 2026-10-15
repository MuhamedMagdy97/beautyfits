import type { Metadata } from "next";
import { AddressBook } from "./address-book";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function AddressesPage() {
  return <AddressBook />;
}
