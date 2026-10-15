import { Wallet } from "./wallet";

/** `/staff/wallet?customer={id}`: the customers screen links here with the id. */
export default async function WalletPage({ searchParams }: PageProps<"/staff/wallet">) {
  const { customer } = await searchParams;
  return <Wallet initialCustomer={typeof customer === "string" ? customer : ""} />;
}
