"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { NotFoundPanel } from "../../_components/not-found-panel";
import {
  Button,
  Loaded,
  Money,
  Page,
  ProductImage,
  QuantityInput,
  useRun,
  useStoreData,
} from "../../_components/shop";
import { redirectToLogin, StoreApiError, storePost, storeSend, track } from "../../_lib/api";
import type { Pagination } from "../../_lib/api";
import { useT } from "../../_lib/i18n";
import { useShopper } from "../../_lib/session";
import type { Product, Review, Variant } from "../../_lib/types";

/**
 * Product detail (Stitch `beautyfits_product_details_ysl_libre_edp`): images,
 * variant choice, add to bag, wishlist, Notify Me for sold-out variants (Q20,
 * Q47) and published reviews. Prices and stock come from the API.
 */
export function ProductDetail({ slug }: { slug: string }) {
  const { state, reload } = useStoreData<Product>(`/api/v1/products/${encodeURIComponent(slug)}`);
  if (
    state.status === "error" &&
    state.error instanceof StoreApiError &&
    state.error.code === "NOT_FOUND"
  ) {
    return <NotFoundPanel />;
  }
  return (
    <Page>
      <Loaded load={state} reload={reload}>
        {(product) => <ProductView key={product.id} product={product} />}
      </Loaded>
    </Page>
  );
}

function ProductView({ product }: { product: Product }) {
  const t = useT();
  const [variantId, setVariantId] = useState(
    (product.variants.find((v) => v.isDefault) ?? product.variants[0]).id,
  );
  const variant = product.variants.find((v) => v.id === variantId) ?? product.variants[0];
  const images = product.images.filter((i) => i.variantId === null || i.variantId === variant.id);
  const [imageIndex, setImageIndex] = useState(0);
  const shown = images[Math.min(imageIndex, images.length - 1)];

  useEffect(() => {
    track({ eventType: "PRODUCT_VIEW", productId: product.id });
  }, [product.id]);

  return (
    <>
      <nav className="mb-6 text-sm text-ink-soft">
        <Link href="/" className="hover:text-plum">
          {t.home}
        </Link>
        {" / "}
        <Link href="/products" className="hover:text-plum">
          {t.shop.title}
        </Link>
        {product.categories[0] ? (
          <>
            {" / "}
            <Link
              href={`/products?categoryId=${product.categories[0].id}`}
              className="hover:text-plum"
            >
              {product.categories[0].name}
            </Link>
          </>
        ) : null}
      </nav>
      <div className="grid gap-10 md:grid-cols-2">
        <div>
          <ProductImage
            src={shown?.url}
            alt={shown?.alt ?? product.name}
            className="aspect-square w-full rounded-xl border border-line"
          />
          {images.length > 1 ? (
            <div className="mt-3 flex gap-2 overflow-x-auto">
              {images.map((image, index) => (
                <button
                  key={image.url}
                  type="button"
                  onClick={() => setImageIndex(index)}
                  aria-label={`${index + 1}`}
                  className={`h-20 w-20 shrink-0 overflow-hidden rounded-md border ${
                    image === shown ? "border-plum" : "border-line"
                  }`}
                >
                  <ProductImage src={image.url} alt="" className="h-full w-full" />
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <div>
          {product.brand ? (
            <Link
              href={`/products?brandId=${product.brand.id}`}
              className="text-xs tracking-[0.2em] text-ink-soft uppercase hover:text-plum"
            >
              {product.brand.name}
            </Link>
          ) : null}
          <h1 className="mt-1 font-[family-name:var(--font-display)] text-3xl text-ink md:text-4xl">
            {product.name}
          </h1>
          <p className="mt-4 text-2xl font-semibold text-plum">
            <Money value={variant.price} />
          </p>
          <p className="text-xs text-ink-soft">{t.shop.taxIncluded}</p>

          {product.variants.length > 1 ? (
            <fieldset className="mt-6">
              <legend className="mb-2 text-sm text-ink-soft">{t.shop.chooseVariant}</legend>
              <div className="flex flex-wrap gap-2">
                {product.variants.map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    aria-pressed={v.id === variant.id}
                    onClick={() => {
                      setVariantId(v.id);
                      setImageIndex(0);
                    }}
                    className={`rounded-md border px-3 py-2 text-sm ${
                      v.id === variant.id
                        ? "border-plum bg-plum text-white"
                        : "border-line bg-white text-ink hover:border-plum"
                    } ${v.status === "OUT_OF_STOCK" ? "line-through decoration-1 opacity-70" : ""}`}
                  >
                    {v.name ?? v.sku}
                  </button>
                ))}
              </div>
            </fieldset>
          ) : null}

          <BuyBox key={variant.id} variant={variant} />

          {product.description ? (
            <section className="mt-10">
              <h2 className="mb-2 font-[family-name:var(--font-display)] text-xl text-ink">
                {t.shop.description}
              </h2>
              <p className="whitespace-pre-line text-ink-soft">{product.description}</p>
            </section>
          ) : null}
        </div>
      </div>
      <Reviews productId={product.id} />
    </>
  );
}

/** Add to bag / Notify Me and wishlist for the chosen variant. */
function BuyBox({ variant }: { variant: Variant }) {
  const t = useT();
  const { shopper, reload } = useShopper();
  const [quantity, setQuantity] = useState(1);
  const { run, pending, notice } = useRun();
  const soldOut = variant.status === "OUT_OF_STOCK";

  const addToBag = () =>
    run(async () => {
      await storePost("/api/v1/cart/items", { variantId: variant.id, quantity });
      reload();
    }, t.shop.addedToBag);

  const addToWishlist = () => {
    if (shopper.status !== "customer") {
      redirectToLogin("required");
      return;
    }
    void run(
      () => storePost("/api/v1/me/wishlist/items", { variantId: variant.id }),
      t.shop.addedToWishlist,
    );
  };

  return (
    <div className="mt-6 space-y-4">
      {notice}
      {soldOut ? (
        <>
          <p className="font-semibold text-danger">{t.shop.outOfStock}</p>
          <NotifyMe variantId={variant.id} />
        </>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <QuantityInput value={quantity} onChange={setQuantity} label={t.shop.quantity} />
          <Button variant="primary" onClick={() => void addToBag()} disabled={pending}>
            {t.shop.addToBag}
          </Button>
          <Link href="/cart" className="text-sm text-plum underline-offset-4 hover:underline">
            {t.shop.viewBag}
          </Link>
        </div>
      )}
      <Button variant="link" onClick={addToWishlist} disabled={pending}>
        ♡ {t.shop.addToWishlist}
      </Button>
    </div>
  );
}

/** Restock subscription (TASK-043): customers only; a guest is asked to sign in. */
function NotifyMe({ variantId }: { variantId: string }) {
  const t = useT();
  const { shopper } = useShopper();
  const customer = shopper.status === "customer";
  const path = `/api/v1/variants/${variantId}/restock-subscription`;
  const { state, set } = useStoreData<{ subscription: { channels: string[] } | null }>(
    customer ? path : null,
  );
  const { run, pending, notice } = useRun();
  const [channels, setChannels] = useState(["WHATSAPP", "EMAIL"]);

  if (!customer) {
    return (
      <Button variant="secondary" onClick={() => redirectToLogin("required")}>
        {t.shop.notifyMe}
      </Button>
    );
  }
  const subscribed = state.status === "ready" && state.data.subscription !== null;
  const toggle = (channel: string) =>
    setChannels((list) =>
      list.includes(channel) ? list.filter((c) => c !== channel) : [...list, channel],
    );

  return (
    <div className="rounded-md border border-line bg-white p-4">
      {notice}
      {subscribed ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-ink">{t.shop.notifySubscribed}</p>
          <Button
            disabled={pending}
            onClick={() => void run(async () => set(await storeSend("DELETE", path)))}
          >
            {t.shop.notifyCancel}
          </Button>
        </div>
      ) : (
        <>
          <p className="mb-2 text-sm text-ink-soft">{t.shop.notifyIntro}</p>
          <div className="mb-3 flex gap-4 text-sm">
            {(["WHATSAPP", "EMAIL"] as const).map((channel) => (
              <label key={channel} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={channels.includes(channel)}
                  onChange={() => toggle(channel)}
                />
                {channel === "WHATSAPP" ? t.shop.whatsapp : t.email}
              </label>
            ))}
          </div>
          <Button
            variant="primary"
            disabled={pending || channels.length === 0}
            onClick={() => void run(async () => set(await storePost(path, { channels })))}
          >
            {t.shop.notifyMe}
          </Button>
        </>
      )}
    </div>
  );
}

function Stars({ rating }: { rating: number }) {
  return (
    <span aria-label={`${rating}/5`} className="text-plum">
      {"★".repeat(Math.round(rating))}
      <span className="text-line">{"★".repeat(5 - Math.round(rating))}</span>
    </span>
  );
}

/** Published reviews (TASK-044); reviewers are never named. */
function Reviews({ productId }: { productId: string }) {
  const t = useT();
  const [page, setPage] = useState(1);
  const { state, reload } = useStoreData<{
    data: { summary: { reviewCount: number; averageRating: number | null }; items: Review[] };
    pagination: Pagination;
  }>(`/api/v1/products/${productId}/reviews?page=${page}&pageSize=10`, true);

  return (
    <section className="mt-16 border-t border-line pt-10">
      <h2 className="mb-4 font-[family-name:var(--font-display)] text-2xl text-ink">
        {t.shop.reviews}
      </h2>
      <Loaded load={state} reload={reload}>
        {({ data, pagination }) =>
          data.summary.reviewCount === 0 ? (
            <p className="text-ink-soft">{t.shop.noReviews}</p>
          ) : (
            <>
              <p className="mb-6 flex items-center gap-3">
                <span className="text-3xl font-semibold text-ink">
                  {data.summary.averageRating}
                </span>
                <Stars rating={data.summary.averageRating ?? 0} />
                <span className="text-sm text-ink-soft">
                  {t.shop.reviewCount.replace("{n}", String(data.summary.reviewCount))}
                </span>
              </p>
              <ul className="space-y-4">
                {data.items.map((review) => (
                  <li key={review.id} className="rounded-xl border border-line bg-white p-5">
                    <div className="mb-2 flex flex-wrap items-center gap-3 text-sm">
                      <Stars rating={review.rating} />
                      <span className="rounded bg-velvet-low px-2 py-0.5 text-xs text-plum">
                        {t.shop.verifiedPurchase}
                      </span>
                      {review.variantName ? (
                        <span className="text-ink-soft">{review.variantName}</span>
                      ) : null}
                      <time className="ms-auto text-ink-soft" dateTime={review.createdAt}>
                        {new Date(review.createdAt).toLocaleDateString()}
                      </time>
                    </div>
                    <p className="whitespace-pre-line text-ink">{review.body}</p>
                  </li>
                ))}
              </ul>
              {pagination.totalPages > 1 ? (
                <div className="mt-6 flex justify-center gap-3">
                  <Button disabled={page <= 1} onClick={() => setPage((n) => n - 1)}>
                    {t.shop.previous}
                  </Button>
                  <Button
                    disabled={page >= pagination.totalPages}
                    onClick={() => setPage((n) => n + 1)}
                  >
                    {t.shop.next}
                  </Button>
                </div>
              ) : null}
            </>
          )
        }
      </Loaded>
    </section>
  );
}
