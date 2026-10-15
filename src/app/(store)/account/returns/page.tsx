import type { Metadata } from "next";
import { ReturnList } from "./return-list";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/** The customer's return requests (TASK-060): `/account/returns?page=`. */
export default async function ReturnsPage({ searchParams }: PageProps<"/account/returns">) {
  const { page } = await searchParams;
  return <ReturnList page={Math.max(1, Number.parseInt(String(page ?? ""), 10) || 1)} />;
}
