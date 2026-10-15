import type { Metadata } from "next";
import { ReturnDetail } from "./return-detail";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/** One return request (TASK-060). */
export default async function ReturnPage({ params }: PageProps<"/account/returns/[returnId]">) {
  const { returnId } = await params;
  return <ReturnDetail returnId={returnId} />;
}
