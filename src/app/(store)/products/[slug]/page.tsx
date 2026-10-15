import { ProductDetail } from "./product-detail";

/** Product page (TASK-059), by slug (or id). */
export default async function ProductPage({ params }: PageProps<"/products/[slug]">) {
  const { slug } = await params;
  return <ProductDetail slug={slug} />;
}
