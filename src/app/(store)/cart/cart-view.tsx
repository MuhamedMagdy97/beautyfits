"use client";

import Link from "next/link";
import { useState } from "react";
import { StatusPanel, TextLink } from "@/app/_components/ui";
import {
  Button,
  Loaded,
  Money,
  Page,
  PageTitle,
  ProductImage,
  QuantityInput,
  useRun,
  useStoreData,
} from "../_components/shop";
import { storePost, storeSend } from "../_lib/api";
import { useT } from "../_lib/i18n";
import { useShopper } from "../_lib/session";
import type { Cart, CartItem } from "../_lib/types";

/**
 * Shopping bag (Stitch `beautyfits_shopping_bag_cart`, API §14, TASK-025/026).
 * The cart holds intent; every number shown comes from the API. Changed
 * prices and stock problems must be reviewed before checkout (Q37).
 */
export function CartView() {
  const t = useT();
  const { shopper, reload: reloadShopper } = useShopper();
  const { state, reload, set } = useStoreData<Cart>("/api/v1/cart");
  const { run, pending, notice } = useRun();

  /** Applies a cart change and shows the cart the API returns. */
  const change = (action: () => Promise<Cart | { cart: Cart }>, success?: string) =>
    void run(async () => {
      const result = await action();
      set("cart" in result ? result.cart : result);
      reloadShopper();
    }, success);

  return (
    <Page>
      <PageTitle>{t.cartPage.title}</PageTitle>
      {notice}
      <Loaded load={state} reload={reload}>
        {(cart) =>
          cart.items.length === 0 ? (
            <StatusPanel
              title={t.cartPage.empty}
              action={<TextLink href="/products">{t.cartPage.continueShopping}</TextLink>}
            />
          ) : (
            <div className="grid gap-8 lg:grid-cols-[1fr_380px]">
              <section>
                {cart.requiresReview ? <ReviewNotice cart={cart} change={change} /> : null}
                <ul className="space-y-4">
                  {cart.items.map((item) => (
                    <Line
                      key={item.id}
                      item={item}
                      pending={pending}
                      canSave={shopper.status === "customer"}
                      change={change}
                    />
                  ))}
                </ul>
              </section>
              <Summary cart={cart} pending={pending} change={change} />
            </div>
          )
        }
      </Loaded>
    </Page>
  );
}

type Change = (action: () => Promise<Cart | { cart: Cart }>, success?: string) => void;

function ReviewNotice({ cart, change }: { cart: Cart; change: Change }) {
  const t = useT();
  const priceChanged = cart.items.some((item) => item.priceChanged);
  return (
    <div className="mb-4 rounded-md border border-blush bg-white p-4 text-sm">
      <p className="text-ink">{t.cartPage.reviewNeeded}</p>
      {priceChanged ? (
        <Button
          variant="secondary"
          className="mt-3"
          onClick={() =>
            change(() => storePost<Cart>("/api/v1/cart/reprice"), t.cartPage.pricesAccepted)
          }
        >
          {t.cartPage.acceptPrices}
        </Button>
      ) : null}
    </div>
  );
}

function Line({
  item,
  pending,
  canSave,
  change,
}: {
  item: CartItem;
  pending: boolean;
  canSave: boolean;
  change: Change;
}) {
  const t = useT();
  const path = `/api/v1/cart/items/${item.id}`;
  return (
    <li className="flex gap-4 rounded-xl border border-line bg-white p-4">
      <Link href={`/products/${item.slug}`} className="shrink-0">
        <ProductImage src={item.imageUrl} alt={item.name} className="h-24 w-24 rounded-md" />
      </Link>
      <div className="flex flex-1 flex-col gap-1">
        <div className="flex flex-wrap justify-between gap-2">
          <Link href={`/products/${item.slug}`} className="text-ink hover:text-plum">
            {item.name}
          </Link>
          {item.lineTotal !== null ? (
            <Money value={item.lineTotal} className="font-semibold text-ink" />
          ) : null}
        </div>
        {item.variantName ? <p className="text-sm text-ink-soft">{item.variantName}</p> : null}
        {item.unitPrice !== null ? (
          <p className="text-sm text-ink-soft">
            {t.cartPage.each} <Money value={item.unitPrice} />
          </p>
        ) : null}
        {item.priceChanged && item.unitPrice !== null ? (
          <p className="text-sm text-danger">
            {t.cartPage.priceWas} <Money value={item.lastSeenUnitPrice} />
          </p>
        ) : null}
        {item.status === "INSUFFICIENT_STOCK" ? (
          <p className="text-sm text-danger">
            {t.cartPage.onlyLeft.replace("{n}", String(item.availableQuantity ?? 0))}
          </p>
        ) : null}
        {item.status === "UNAVAILABLE" ? (
          <p className="text-sm text-danger">{t.cartPage.unavailable}</p>
        ) : null}
        <div className="mt-auto flex flex-wrap items-center gap-4 pt-2">
          {item.status !== "UNAVAILABLE" ? (
            <QuantityInput
              value={item.quantity}
              disabled={pending}
              label={t.shop.quantity}
              onChange={(quantity) => change(() => storeSend<Cart>("PATCH", path, { quantity }))}
            />
          ) : null}
          {canSave ? (
            <Button
              variant="link"
              disabled={pending}
              onClick={() =>
                change(async () => {
                  await storePost("/api/v1/me/wishlist/items", { variantId: item.variantId });
                  return storeSend<Cart>("DELETE", path);
                })
              }
            >
              {t.cartPage.moveToWishlist}
            </Button>
          ) : null}
          <Button
            variant="link"
            disabled={pending}
            onClick={() => change(() => storeSend<Cart>("DELETE", path))}
          >
            {t.cartPage.remove}
          </Button>
        </div>
      </div>
    </li>
  );
}

function Summary({ cart, pending, change }: { cart: Cart; pending: boolean; change: Change }) {
  const t = useT();
  const [code, setCode] = useState("");
  const row = "flex justify-between gap-4 py-1 text-sm";
  return (
    <aside className="h-fit rounded-xl border border-line bg-white p-6">
      <h2 className="mb-4 font-[family-name:var(--font-display)] text-2xl text-ink">
        {t.cartPage.summary}
      </h2>
      <div className={row}>
        <span>{t.cartPage.subtotal.replace("{n}", String(cart.itemCount))}</span>
        <Money value={cart.subtotal} />
      </div>
      {cart.discount ? (
        <div className={row}>
          <span>
            {t.cartPage.discount} ({cart.discount.code ?? cart.discount.name})
          </span>
          <span className="text-plum">
            − <Money value={cart.discountTotal} />
          </span>
        </div>
      ) : null}
      <div className={row}>
        <span>{t.cartPage.shipping}</span>
        <span className="text-ink-soft">{t.cartPage.shippingAtCheckout}</span>
      </div>
      <div className="mt-3 flex justify-between border-t border-line pt-3 text-lg font-semibold">
        <span>{t.cartPage.total}</span>
        <Money value={cart.total} />
      </div>

      <div className="mt-6 border-t border-line pt-4">
        {cart.discountProblem ? (
          <p className="mb-2 text-sm text-danger">
            {t.discountReasons[cart.discountProblem.reason] ?? t.discountReasons.default}
          </p>
        ) : null}
        {cart.discount || cart.discountProblem ? (
          <Button
            variant="link"
            disabled={pending}
            onClick={() => change(() => storeSend<Cart>("DELETE", "/api/v1/cart/discount"))}
          >
            {t.cartPage.removeDiscount}
          </Button>
        ) : (
          <>
            <form
              className="flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (code.trim()) {
                  change(() =>
                    storeSend<Cart>("PUT", "/api/v1/cart/discount", { code: code.trim() }),
                  );
                }
              }}
            >
              <input
                value={code}
                onChange={(event) => setCode(event.target.value)}
                aria-label={t.cartPage.discountCode}
                placeholder={t.cartPage.discountCode}
                dir="ltr"
                className="min-w-0 flex-1 rounded-md border border-line bg-velvet-low px-3 py-2 text-sm"
              />
              <Button type="submit" disabled={pending}>
                {t.cartPage.apply}
              </Button>
            </form>
            {cart.availableDiscounts.length > 0 ? (
              <div className="mt-4">
                <p className="mb-2 text-sm text-ink-soft">{t.cartPage.offers}</p>
                <ul className="space-y-2">
                  {cart.availableDiscounts.map((offer) => (
                    <li key={offer.id} className="flex items-center justify-between gap-2 text-sm">
                      <span>
                        {offer.name} (−
                        <Money value={offer.amount} />)
                      </span>
                      <Button
                        disabled={pending}
                        onClick={() =>
                          change(() =>
                            storeSend<Cart>("PUT", "/api/v1/cart/discount", {
                              discountId: offer.id,
                            }),
                          )
                        }
                      >
                        {t.cartPage.choose}
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </>
        )}
      </div>

      {cart.requiresReview ? (
        <p className="mt-6 text-sm text-danger">{t.cartPage.fixBeforeCheckout}</p>
      ) : (
        <Link
          href="/checkout"
          className="mt-6 block rounded-md bg-plum px-4 py-3 text-center text-sm font-semibold tracking-wide text-white uppercase hover:bg-plum-soft"
        >
          {t.cartPage.checkout}
        </Link>
      )}
      <p className="mt-3 text-center text-xs text-ink-soft">{t.cartPage.codNote}</p>
    </aside>
  );
}
