"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { StatusPanel, TextLink } from "@/app/_components/ui";
import {
  AddressFields,
  addressFromForm,
  addressLine,
  TextInput,
} from "../_components/address-form";
import { Button, Loaded, Money, Page, PageTitle, useRun, useStoreData } from "../_components/shop";
import { StoreApiError, storePost, track } from "../_lib/api";
import { errorMessage, useT } from "../_lib/i18n";
import { useShopper } from "../_lib/session";
import type { Address, Cart, PlacedOrder, Quote } from "../_lib/types";

/**
 * Cash-on-delivery checkout (Stitch `beautyfits_checkout_cash_on_delivery`,
 * API "TASK-029 Amendments", User Flows §6.2). The shopper fills contact and
 * address, the API quotes the order (`/checkout/validate`), the shopper
 * confirms that total and the API places the order with an idempotency key.
 * The website computes nothing: shipping, discount and totals are the API's.
 */
export function CheckoutForm() {
  const t = useT();
  const { shopper } = useShopper();
  const cart = useStoreData<Cart>(shopper.status === "loading" ? null : "/api/v1/cart");
  const [placed, setPlaced] = useState<PlacedOrder | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (cart.state.status === "ready" && cart.state.data.items.length > 0 && !started.current) {
      started.current = true;
      track({ eventType: "CHECKOUT_STARTED" });
    }
  }, [cart.state]);

  if (placed) {
    return <Confirmation order={placed} guest={shopper.status !== "customer"} />;
  }
  return (
    <Page>
      <PageTitle>{t.checkout.title}</PageTitle>
      <Loaded load={cart.state} reload={cart.reload}>
        {(data) =>
          data.items.length === 0 ? (
            <StatusPanel
              title={t.cartPage.empty}
              action={<TextLink href="/products">{t.cartPage.continueShopping}</TextLink>}
            />
          ) : (
            <CheckoutSteps
              cart={data}
              customer={shopper.status === "customer"}
              onPlaced={setPlaced}
            />
          )
        }
      </Loaded>
    </Page>
  );
}

type QuoteBody = Record<string, unknown>;

function CheckoutSteps({
  cart,
  customer,
  onPlaced,
}: {
  cart: Cart;
  customer: boolean;
  onPlaced: (order: PlacedOrder) => void;
}) {
  const t = useT();
  const { reload: reloadShopper } = useShopper();
  const addresses = useStoreData<Address[]>(customer ? "/api/v1/me/addresses" : null);
  const wallet = useStoreData<{ available: number }>(customer ? "/api/v1/me/wallet" : null);
  const [addressChoice, setAddressChoice] = useState<string>("");
  const [useWallet, setUseWallet] = useState(false);
  const [quote, setQuote] = useState<{ body: QuoteBody; result: Quote; key: string } | null>(null);
  const { run, pending, notice, say } = useRun();

  const saved = addresses.state.status === "ready" ? addresses.state.data : [];
  const chosen = addressChoice || (saved.find((a) => a.isDefault) ?? saved[0])?.id || "new";
  const available = wallet.state.status === "ready" ? wallet.state.data.available : 0;

  /** The quote request from the form (the API validates it). */
  function bodyFrom(form: FormData): QuoteBody {
    const body: QuoteBody = {};
    if (!customer) {
      const email = String(form.get("email") ?? "").trim();
      body.contact = {
        fullName: String(form.get("fullName") ?? "").trim(),
        phone: String(form.get("contactPhone") ?? "").trim(),
        ...(email ? { email } : {}),
      };
    }
    if (customer && chosen !== "new") {
      body.addressId = chosen;
    } else {
      body.address = addressFromForm(form);
    }
    return body;
  }

  const onReview = (form: FormData) =>
    void run(async () => {
      const body = bodyFrom(form);
      let result = await storePost<Quote>("/api/v1/checkout/validate", body);
      if (useWallet && available > 0) {
        // Wallet credit up to the total (Q167, Q168); the API checks both again.
        body.walletAmount = Math.min(available, result.total);
        result = await storePost<Quote>("/api/v1/checkout/validate", body);
      }
      setQuote({ body, result, key: crypto.randomUUID() });
    });

  const onPlace = () =>
    void run(async () => {
      if (!quote) {
        return;
      }
      try {
        const order = await storePost<PlacedOrder>(
          "/api/v1/checkout",
          { ...quote.body, expectedTotal: quote.result.total },
          { headers: { "idempotency-key": quote.key } },
        );
        reloadShopper();
        onPlaced(order);
      } catch (error) {
        if (
          error instanceof StoreApiError &&
          ["PRICE_CHANGED", "STOCK_CHANGED", "DISCOUNT_INVALID", "DISCOUNT_EXPIRED"].includes(
            error.code,
          )
        ) {
          // Something changed since the review (R38.2): review again from the bag.
          setQuote(null);
          say({ tone: "error", text: errorMessage(t, error) });
          return;
        }
        throw error;
      }
    });

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_400px]">
      <form
        method="post"
        onChange={() => setQuote(null)}
        onSubmit={(event) => {
          event.preventDefault();
          onReview(new FormData(event.currentTarget));
        }}
        className="space-y-6"
      >
        {!customer ? (
          <Section number={1} title={t.checkout.contact}>
            <p className="mb-4 text-sm text-ink-soft">
              {t.checkout.guestIntro} <TextLink href="/login?next=%2Fcheckout">{t.signIn}</TextLink>
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <TextInput label={t.fullName} name="fullName" required autoComplete="name" />
              <TextInput
                label={t.phone}
                name="contactPhone"
                required
                type="tel"
                autoComplete="tel"
                dir="ltr"
                placeholder="01xxxxxxxxx"
              />
              <TextInput
                label={t.checkout.emailOptional}
                name="email"
                type="email"
                autoComplete="email"
                dir="ltr"
              />
            </div>
          </Section>
        ) : null}

        <Section number={customer ? 1 : 2} title={t.checkout.address}>
          {customer && saved.length > 0 ? (
            <div className="mb-4 space-y-2">
              {saved.map((address) => (
                <label
                  key={address.id}
                  className="flex cursor-pointer gap-3 rounded-md border border-line p-3 text-sm"
                >
                  <input
                    type="radio"
                    name="addressChoice"
                    checked={chosen === address.id}
                    onChange={() => setAddressChoice(address.id)}
                  />
                  <span>
                    <span className="block text-ink">
                      {address.label ? `${address.label} — ` : ""}
                      {address.recipientName}
                    </span>
                    <span className="block text-ink-soft">{addressLine(address)}</span>
                  </span>
                </label>
              ))}
              <label className="flex cursor-pointer gap-3 rounded-md border border-line p-3 text-sm">
                <input
                  type="radio"
                  name="addressChoice"
                  checked={chosen === "new"}
                  onChange={() => setAddressChoice("new")}
                />
                {t.checkout.newAddress}
              </label>
            </div>
          ) : null}
          {!customer || chosen === "new" || addresses.state.status !== "ready" ? (
            addresses.state.status === "loading" && customer ? (
              <p className="text-ink-soft">{t.loading}</p>
            ) : (
              <AddressFields />
            )
          ) : null}
        </Section>

        <Section number={customer ? 2 : 3} title={t.checkout.payment}>
          <p className="text-sm text-ink">{t.checkout.cod}</p>
          <p className="mt-1 text-sm text-ink-soft">{t.checkout.codExplain}</p>
          {customer && available > 0 ? (
            <label className="mt-4 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={useWallet}
                onChange={(event) => setUseWallet(event.target.checked)}
              />
              {t.checkout.useWallet} (<Money value={available} />)
            </label>
          ) : null}
        </Section>

        {notice}
        <Button type="submit" variant="primary" disabled={pending} className="w-full">
          {t.checkout.review}
        </Button>
      </form>

      <aside className="h-fit rounded-xl border border-line bg-white p-6">
        <h2 className="mb-4 font-[family-name:var(--font-display)] text-2xl text-ink">
          {t.cartPage.summary}
        </h2>
        <ul className="mb-4 space-y-2 text-sm">
          {cart.items.map((item) => (
            <li key={item.id} className="flex justify-between gap-3">
              <span>
                {item.name}
                {item.variantName ? ` — ${item.variantName}` : ""} × {item.quantity}
              </span>
              {item.lineTotal !== null ? <Money value={item.lineTotal} /> : null}
            </li>
          ))}
        </ul>
        <Link href="/cart" className="text-sm text-plum underline-offset-4 hover:underline">
          {t.checkout.editBag}
        </Link>
        {quote ? (
          <QuoteSummary quote={quote.result} pending={pending} onPlace={onPlace} />
        ) : (
          <p className="mt-4 border-t border-line pt-4 text-sm text-ink-soft">
            {t.checkout.reviewFirst}
          </p>
        )}
      </aside>
    </div>
  );
}

function Section({
  number,
  title,
  children,
}: {
  number: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-line bg-white p-6">
      <h2 className="mb-4 flex items-center gap-3 font-[family-name:var(--font-display)] text-xl text-ink">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-plum text-sm text-white">
          {number}
        </span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function QuoteSummary({
  quote,
  pending,
  onPlace,
}: {
  quote: Quote;
  pending: boolean;
  onPlace: () => void;
}) {
  const t = useT();
  const row = "flex justify-between gap-4 py-1 text-sm";
  return (
    <div className="mt-4 border-t border-line pt-4">
      <div className={row}>
        <span>
          {t.cartPage.subtotal.replace(
            "{n}",
            String(quote.items.reduce((n, item) => n + item.quantity, 0)),
          )}
        </span>
        <Money value={quote.subtotal} />
      </div>
      {quote.discountTotal > 0 ? (
        <div className={row}>
          <span>{t.cartPage.discount}</span>
          <span>
            − <Money value={quote.discountTotal} />
          </span>
        </div>
      ) : null}
      <div className={row}>
        <span>{t.cartPage.shipping}</span>
        {quote.freeShipping ? (
          <span className="text-plum">{t.checkout.freeShipping}</span>
        ) : (
          <Money value={quote.shippingFee} />
        )}
      </div>
      {quote.walletAmount > 0 ? (
        <div className={row}>
          <span>{t.checkout.wallet}</span>
          <span>
            − <Money value={quote.walletAmount} />
          </span>
        </div>
      ) : null}
      <div className="mt-3 flex justify-between border-t border-line pt-3 text-lg font-semibold">
        <span>{t.checkout.payOnDelivery}</span>
        <Money value={quote.codAmount} />
      </div>
      <p className="text-xs text-ink-soft">
        {t.cartPage.total}: <Money value={quote.total} /> · {t.shop.taxIncluded}
      </p>
      <Button variant="primary" className="mt-6 w-full" disabled={pending} onClick={onPlace}>
        {t.checkout.place}
      </Button>
    </div>
  );
}

/** Order placed (Stitch `beautyfits_order_confirmation_cod_pending`, R16, R39). */
function Confirmation({ order, guest }: { order: PlacedOrder; guest: boolean }) {
  const t = useT();
  return (
    <Page>
      <div className="mx-auto max-w-xl rounded-xl border border-line bg-white p-8 text-center">
        <h1 className="font-[family-name:var(--font-display)] text-3xl text-plum">
          {t.checkout.thanks}
        </h1>
        <p className="mt-4 text-ink">
          {t.checkout.orderNumber}{" "}
          <span className="font-semibold" dir="ltr">
            {order.orderNumber}
          </span>
        </p>
        <p className="mt-2 text-ink">
          {t.checkout.payOnDelivery}: <Money value={order.codAmount} />
        </p>
        <p className="mt-4 text-sm text-ink-soft">
          {order.status === "PENDING_CONFIRMATION"
            ? t.checkout.pendingConfirmation
            : t.checkout.confirmed}
        </p>
        {guest ? <p className="mt-4 text-sm text-ink-soft">{t.checkout.guestOrders}</p> : null}
        <div className="mt-6">
          <TextLink href="/products">{t.cartPage.continueShopping}</TextLink>
        </div>
      </div>
    </Page>
  );
}
