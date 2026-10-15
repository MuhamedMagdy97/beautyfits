"use client";

import Link from "next/link";
import { ProductCard, useStoreData } from "./_components/shop";
import type { Pagination } from "./_lib/api";
import { useT } from "./_lib/i18n";
import type { ProductSummary } from "./_lib/types";

/** Home page (TASK-058) with the newest products (TASK-059). */
export default function HomePage() {
  const t = useT();
  const { state } = useStoreData<{ data: ProductSummary[]; pagination: Pagination }>(
    "/api/v1/products?pageSize=8",
    true,
  );
  return (
    <main className="mx-auto w-full max-w-[1360px] flex-1 px-4 py-20 md:px-8">
      <h1 className="font-[family-name:var(--font-display)] text-4xl text-plum md:text-6xl">
        {t.homeTitle}
      </h1>
      <p className="mt-4 max-w-xl text-lg text-ink-soft">{t.homeIntro}</p>
      <Link
        href="/products"
        className="mt-8 inline-block rounded-md bg-plum px-6 py-3 text-sm font-semibold tracking-wide text-white uppercase hover:bg-plum-soft"
      >
        {t.shop.shopNow}
      </Link>
      {state.status === "ready" && state.data.data.length > 0 ? (
        <section className="mt-16">
          <h2 className="mb-6 font-[family-name:var(--font-display)] text-2xl text-ink">
            {t.shop.newArrivals}
          </h2>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {state.data.data.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        </section>
      ) : null}
    </main>
  );
}
