import type { Metadata } from "next";
import { WalletView } from "./wallet-view";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/** Wallet balance and activity (TASK-060): `/account/wallet?page=`. */
export default async function WalletPage({ searchParams }: PageProps<"/account/wallet">) {
  const { page } = await searchParams;
  return <WalletView page={Math.max(1, Number.parseInt(String(page ?? ""), 10) || 1)} />;
}
