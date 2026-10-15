"use client";

import Link from "next/link";
import { StatusPanel, TextLink } from "@/app/_components/ui";
import {
  Button,
  CustomerOnly,
  Loaded,
  Money,
  Page,
  PageTitle,
  ProductImage,
  useRun,
  useStoreData,
} from "../_components/shop";
import { AccountNav } from "../account/account-nav";
import { storePost, storeSend } from "../_lib/api";
import { useT } from "../_lib/i18n";
import { useShopper } from "../_lib/session";
import type { WishlistItem } from "../_lib/types";

interface Wishlist {
  items: WishlistItem[];
}

/**
 * Wishlist (API "TASK-042 Amendments", Q4, Q47, Q48): account-only; sold-out
 * and unavailable items stay visible, sold-out ones link to Notify Me on the
 * product page.
 */
export function WishlistView() {
  const t = useT();
  return (
    <Page>
      <PageTitle>{t.wishlistPage.title}</PageTitle>
      <AccountNav />
      <CustomerOnly>
        <Items />
      </CustomerOnly>
    </Page>
  );
}

function Items() {
  const t = useT();
  const { reload: reloadShopper } = useShopper();
  const { state, reload, set } = useStoreData<Wishlist>("/api/v1/me/wishlist");
  const { run, pending, notice } = useRun();

  return (
    <Loaded load={state} reload={reload}>
      {(wishlist) =>
        wishlist.items.length === 0 ? (
          <StatusPanel
            title={t.wishlistPage.empty}
            action={<TextLink href="/products">{t.cartPage.continueShopping}</TextLink>}
          />
        ) : (
          <>
            {notice}
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {wishlist.items.map((item) => (
                <li key={item.id} className="flex gap-4 rounded-xl border border-line bg-white p-4">
                  <Link href={`/products/${item.slug}`} className="shrink-0">
                    <ProductImage
                      src={item.imageUrl}
                      alt={item.name}
                      className="h-24 w-24 rounded-md"
                    />
                  </Link>
                  <div className="flex flex-1 flex-col gap-1 text-sm">
                    <Link href={`/products/${item.slug}`} className="text-ink hover:text-plum">
                      {item.name}
                    </Link>
                    {item.variantName ? (
                      <span className="text-ink-soft">{item.variantName}</span>
                    ) : null}
                    {item.unitPrice !== null ? <Money value={item.unitPrice} /> : null}
                    {item.status === "OUT_OF_STOCK" ? (
                      <Link href={`/products/${item.slug}`} className="text-danger">
                        {t.shop.outOfStock} · {t.shop.notifyMe}
                      </Link>
                    ) : null}
                    {item.status === "UNAVAILABLE" ? (
                      <span className="text-danger">{t.cartPage.unavailable}</span>
                    ) : null}
                    <div className="mt-auto flex flex-wrap gap-3 pt-2">
                      {item.status === "AVAILABLE" ? (
                        <Button
                          variant="link"
                          disabled={pending}
                          onClick={() =>
                            void run(async () => {
                              const result = await storePost<{ wishlist: Wishlist }>(
                                `/api/v1/me/wishlist/items/${item.id}/move-to-cart`,
                              );
                              set(result.wishlist);
                              reloadShopper();
                            }, t.shop.addedToBag)
                          }
                        >
                          {t.wishlistPage.moveToBag}
                        </Button>
                      ) : null}
                      <Button
                        variant="link"
                        disabled={pending}
                        onClick={() =>
                          void run(async () =>
                            set(
                              await storeSend<Wishlist>(
                                "DELETE",
                                `/api/v1/me/wishlist/items/${item.id}`,
                              ),
                            ),
                          )
                        }
                      >
                        {t.cartPage.remove}
                      </Button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )
      }
    </Loaded>
  );
}
