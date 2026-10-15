import type { Metadata } from "next";
import { AccountView } from "./account-view";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function AccountPage() {
  return <AccountView />;
}
