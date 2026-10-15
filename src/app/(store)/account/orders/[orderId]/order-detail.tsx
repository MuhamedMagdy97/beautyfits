"use client";

import Link from "next/link";
import { useState } from "react";
import { Notice } from "@/app/_components/ui";
import {
  Button,
  CustomerOnly,
  Loaded,
  Money,
  Page,
  PageTitle,
  QuantityInput,
  useRun,
  useStoreData,
} from "../../../_components/shop";
import {
  addressLine,
  formatDate,
  orderActions,
  type CustomerOrder,
  type Revision,
} from "../../../_lib/account";
import { StoreApiError, storePost } from "../../../_lib/api";
import { useLang, useT } from "../../../_lib/i18n";
import type { Address } from "../../../_lib/types";
import { AccountNav } from "../../account-nav";
import { ReturnForm } from "../../returns/return-form";
import { StatusBadge } from "../order-list";

/**
 * Order detail (TASK-060; API "TASK-030" … "TASK-036" Amendments): progress,
 * delivery tracking, and the customer's own actions. Each action is offered
 * by status only; the API decides and its refusal is shown.
 */
export function OrderDetail({ orderId }: { orderId: string }) {
  const t = useT();
  return (
    <Page>
      <PageTitle>{t.my.orders}</PageTitle>
      <AccountNav />
      <CustomerOnly>
        <Detail orderId={orderId} />
      </CustomerOnly>
    </Page>
  );
}

const section = "rounded-xl border border-line bg-white p-5";
const heading = "mb-3 font-[family-name:var(--font-display)] text-xl text-plum";

function Detail({ orderId }: { orderId: string }) {
  const t = useT();
  const lang = useLang();
  const { state, reload, set } = useStoreData<CustomerOrder>(`/api/v1/orders/${orderId}`);
  const [panel, setPanel] = useState<"cancel" | "modify" | "return" | null>(null);
  const { run, pending, notice, say } = useRun();

  return (
    <Loaded load={state} reload={reload}>
      {(order) => {
        const actions = orderActions(order.status);
        return (
          <div className="space-y-5">
            <Link href="/account/orders" className="text-sm text-plum hover:underline">
              {t.my.backToOrders}
            </Link>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-2xl text-ink" dir="ltr">
                  {order.orderNumber}
                </h2>
                <p className="text-sm text-ink-soft">
                  {t.my.placedOn.replace("{date}", formatDate(order.createdAt, lang, true))}
                </p>
              </div>
              <StatusBadge status={t.my.status[order.status] ?? order.status} />
            </div>
            {notice}
            {order.status === "PENDING_CONFIRMATION" ? (
              <Notice tone="info">{t.my.codConfirmNote}</Notice>
            ) : null}
            {order.pendingRevision ? (
              <RevisionPanel
                revision={order.pendingRevision}
                pending={pending}
                onConfirm={() =>
                  void run(async () => {
                    set(
                      await storePost<CustomerOrder>(
                        `/api/v1/orders/${order.id}/revisions/${order.pendingRevision!.id}/confirm`,
                      ),
                    );
                  }, t.my.changeConfirmed)
                }
              />
            ) : null}

            <div className="flex flex-wrap gap-2">
              {actions.modify ? (
                <Button onClick={() => setPanel(panel === "modify" ? null : "modify")}>
                  {t.my.modify}
                </Button>
              ) : null}
              {actions.cancel ||
              (actions.stopDelivery && !order.shipments.some((s) => s.cancellationRequestedAt)) ? (
                <Button onClick={() => setPanel(panel === "cancel" ? null : "cancel")}>
                  {actions.cancel ? t.my.cancel : t.my.stopDelivery}
                </Button>
              ) : null}
              {actions.afterDelivery ? (
                <Button
                  variant="primary"
                  onClick={() => setPanel(panel === "return" ? null : "return")}
                >
                  {t.my.requestReturn}
                </Button>
              ) : null}
            </div>
            {panel === "cancel" ? (
              <CancelPanel
                order={order}
                onDone={(next) => {
                  set(next);
                  say({
                    tone: "info",
                    text: next.status === "CANCELLED" ? t.my.cancelled : t.my.stopRequested,
                  });
                  setPanel(null);
                }}
                onClose={() => setPanel(null)}
              />
            ) : null}
            {panel === "modify" ? (
              <ModifyPanel
                order={order}
                onDone={() => {
                  setPanel(null);
                  reload();
                }}
              />
            ) : null}
            {panel === "return" ? (
              <section className={section}>
                <h3 className={heading}>{t.my.requestReturn}</h3>
                <ReturnForm
                  path={`/api/v1/orders/${order.id}/returns`}
                  lines={order.items.map((item) => ({
                    orderItemId: item.id,
                    name: item.name,
                    variantName: item.variantName,
                    quantity: item.quantity,
                  }))}
                />
              </section>
            ) : null}

            <div className="grid gap-5 lg:grid-cols-[2fr_1fr]">
              <div className="space-y-5">
                <section className={section}>
                  <h3 className={heading}>{t.returnsPage.items}</h3>
                  <ul className="divide-y divide-line">
                    {order.items.map((item) => (
                      <OrderLineRow
                        key={item.id}
                        orderId={order.id}
                        item={item}
                        canReview={actions.afterDelivery}
                      />
                    ))}
                  </ul>
                </section>
                {order.shipments.length > 0 ? <Tracking order={order} /> : null}
              </div>
              <div className="space-y-5">
                <section className={section}>
                  <h3 className={heading}>{t.my.summary}</h3>
                  <dl className="space-y-2 text-sm">
                    <Row label={t.my.subtotal} value={order.subtotal} />
                    {order.discountTotal > 0 ? (
                      <Row
                        label={`${t.cartPage.discount}${order.discount?.name ? ` (${order.discount.name})` : ""}`}
                        value={-order.discountTotal}
                      />
                    ) : null}
                    <Row label={t.cartPage.shipping} value={order.shippingFee} />
                    <Row label={t.my.total} value={order.total} strong />
                    {order.walletAmount > 0 ? (
                      <Row label={t.my.paidByWallet} value={-order.walletAmount} />
                    ) : null}
                    <Row label={t.checkout.payOnDelivery} value={order.codAmount} strong />
                  </dl>
                </section>
                <section className={section}>
                  <h3 className={heading}>{t.my.deliverTo}</h3>
                  <p className="text-sm text-ink">{order.shippingAddress.recipientName}</p>
                  <p className="text-sm text-ink-soft" dir="ltr">
                    {order.shippingAddress.phone}
                  </p>
                  <p className="text-sm text-ink-soft">
                    {addressLine(order.shippingAddress, lang)}
                  </p>
                </section>
                <section className={section}>
                  <h3 className={heading}>{t.my.timeline}</h3>
                  <ol className="space-y-3 border-s border-line ps-4">
                    {order.statusHistory.map((step, i) => (
                      <li key={`${step.status}-${i}`} className="text-sm">
                        <p className="text-ink">{t.my.status[step.status] ?? step.status}</p>
                        <p className="text-xs text-ink-soft">{formatDate(step.at, lang, true)}</p>
                      </li>
                    ))}
                  </ol>
                </section>
              </div>
            </div>
          </div>
        );
      }}
    </Loaded>
  );
}

function Row({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-3 ${strong ? "font-semibold text-ink" : ""}`}>
      <dt>{label}</dt>
      <dd>
        <Money value={value} />
      </dd>
    </div>
  );
}

function OrderLineRow({
  orderId,
  item,
  canReview,
}: {
  orderId: string;
  item: CustomerOrder["items"][number];
  canReview: boolean;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <li className="py-3 text-sm">
      <div className="flex flex-wrap justify-between gap-3">
        <div>
          <p className="text-ink">{item.name}</p>
          {item.variantName ? <p className="text-ink-soft">{item.variantName}</p> : null}
          <p className="text-ink-soft">
            {t.shop.quantity}: {item.quantity}
          </p>
        </div>
        <div className="text-end">
          <Money value={item.lineTotal} className="font-semibold text-ink" />
          {canReview ? (
            <div>
              <Button variant="link" onClick={() => setOpen(!open)}>
                {t.my.reviewItem}
              </Button>
            </div>
          ) : null}
        </div>
      </div>
      {open ? <ReviewForm orderId={orderId} orderItemId={item.id} /> : null}
    </li>
  );
}

/** Verified-purchase review (API "TASK-044 Amendments"). */
function ReviewForm({ orderId, orderItemId }: { orderId: string; orderItemId: string }) {
  const t = useT();
  const { run, pending, notice, say } = useRun();
  const [done, setDone] = useState(false);
  if (done) {
    return notice;
  }
  return (
    <form
      method="post"
      className="mt-3 space-y-3 rounded-md bg-velvet-low p-4"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        void run(async () => {
          try {
            await storePost(`/api/v1/orders/${orderId}/items/${orderItemId}/review`, {
              rating: Number(form.get("rating")),
              body: String(form.get("body") ?? "").trim(),
            });
            say({ tone: "info", text: t.my.reviewed });
          } catch (error) {
            // One review per order and product: the API names the existing one.
            if (!(error instanceof StoreApiError && typeof error.details.reviewId === "string")) {
              throw error;
            }
            say({ tone: "info", text: t.my.alreadyReviewed });
          }
          setDone(true);
        });
      }}
    >
      {notice}
      <fieldset>
        <legend className="mb-1 text-ink-soft">{t.my.rating}</legend>
        <div className="flex gap-3">
          {[1, 2, 3, 4, 5].map((n) => (
            <label key={n} className="flex items-center gap-1">
              <input type="radio" name="rating" value={n} required defaultChecked={n === 5} />
              <span aria-label={t.my.stars.replace("{n}", String(n))}>{"★".repeat(n)}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <label className="block text-ink-soft">
        <span className="mb-1 block">{t.my.reviewBody}</span>
        <textarea
          name="body"
          required
          maxLength={2000}
          rows={3}
          className="block w-full rounded-md border border-line bg-white px-3 py-2 text-base text-ink"
        />
      </label>
      <Button type="submit" variant="primary" disabled={pending}>
        {t.my.publish}
      </Button>
    </form>
  );
}

function Tracking({ order }: { order: CustomerOrder }) {
  const t = useT();
  const lang = useLang();
  return (
    <section className={section}>
      <h3 className={heading}>{t.my.tracking}</h3>
      {order.shipments.map((shipment, i) => (
        <div key={i} className="space-y-3 text-sm">
          <dl className="grid gap-1 sm:grid-cols-[140px_1fr]">
            <dt className="text-ink-soft">{t.my.carrier}</dt>
            <dd>{shipment.company.name}</dd>
            {shipment.trackingNumber ? (
              <>
                <dt className="text-ink-soft">{t.my.trackingNumber}</dt>
                <dd dir="ltr" className="text-start">
                  {shipment.trackingNumber}
                </dd>
              </>
            ) : null}
          </dl>
          <StatusBadge status={t.my.shipmentStatus[shipment.status] ?? shipment.status} />
          {shipment.cancellationRequestedAt ? (
            <p className="text-ink-soft">
              {t.my.cancellationRequested.replace(
                "{date}",
                formatDate(shipment.cancellationRequestedAt, lang, true),
              )}
            </p>
          ) : null}
          <ol className="space-y-2 border-s border-line ps-4">
            {shipment.events.map((event, j) => (
              <li key={j}>
                <p className="text-ink">{t.my.shipmentEvent[event.type] ?? event.type}</p>
                <p className="text-xs text-ink-soft">{formatDate(event.at, lang, true)}</p>
              </li>
            ))}
          </ol>
        </div>
      ))}
    </section>
  );
}

/** Cancel (R11) or, once shipped, ask the carrier to stop (TASK-036). */
function CancelPanel({
  order,
  onDone,
  onClose,
}: {
  order: CustomerOrder;
  onDone: (order: CustomerOrder) => void;
  onClose: () => void;
}) {
  const t = useT();
  const { run, pending, notice } = useRun();
  const shipped = order.status === "SHIPPED";
  return (
    <form
      method="post"
      className={`${section} space-y-3`}
      onSubmit={(event) => {
        event.preventDefault();
        const reason = String(new FormData(event.currentTarget).get("reason") ?? "").trim();
        void run(async () => {
          onDone(
            await storePost<CustomerOrder>(
              `/api/v1/orders/${order.id}/cancel`,
              reason ? { reason } : {},
            ),
          );
        });
      }}
    >
      {notice}
      <p className="text-sm text-ink">{shipped ? t.my.stopConfirm : t.my.cancelConfirm}</p>
      <label className="block text-sm text-ink-soft">
        <span className="mb-1 block">{t.my.cancelReason}</span>
        <textarea
          name="reason"
          maxLength={500}
          rows={2}
          className="block w-full rounded-md border border-line bg-velvet-low px-3 py-2 text-base text-ink"
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary" disabled={pending}>
          {shipped ? t.my.stopDelivery : t.my.cancel}
        </Button>
        <Button onClick={onClose}>{t.my.keepOrder}</Button>
      </div>
    </form>
  );
}

/**
 * Order change request (API "TASK-032 Amendments"): the whole new list, each
 * variant once, and optionally another saved address. The API prices it and
 * answers with a revision the customer confirms.
 */
function ModifyPanel({ order, onDone }: { order: CustomerOrder; onDone: () => void }) {
  const t = useT();
  const { run, pending, notice } = useRun();
  const addresses = useStoreData<Address[]>("/api/v1/me/addresses");
  // A variant may appear twice (order price and today's price, R40): one row per variant.
  const [lines, setLines] = useState(() => {
    const byVariant = new Map<string, { variantId: string; label: string; quantity: number }>();
    for (const item of order.items) {
      const line = byVariant.get(item.variantId);
      if (line) {
        line.quantity += item.quantity;
      } else {
        byVariant.set(item.variantId, {
          variantId: item.variantId,
          label: [item.name, item.variantName].filter(Boolean).join(" — "),
          quantity: item.quantity,
        });
      }
    }
    return [...byVariant.values()];
  });
  const [addressId, setAddressId] = useState("");
  return (
    <form
      method="post"
      className={`${section} space-y-4`}
      onSubmit={(event) => {
        event.preventDefault();
        void run(async () => {
          await storePost(`/api/v1/orders/${order.id}/modify`, {
            items: lines.map(({ variantId, quantity }) => ({ variantId, quantity })),
            ...(addressId ? { addressId } : {}),
          });
          onDone();
        });
      }}
    >
      {notice}
      <p className="text-sm text-ink-soft">{t.my.modifyIntro}</p>
      <ul className="space-y-3">
        {lines.map((line, i) => (
          <li key={line.variantId} className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm text-ink">{line.label}</span>
            <span className="flex items-center gap-2">
              <QuantityInput
                label={t.shop.quantity}
                value={line.quantity}
                onChange={(quantity) =>
                  setLines(lines.map((l, j) => (j === i ? { ...l, quantity } : l)))
                }
              />
              {lines.length > 1 ? (
                <Button variant="link" onClick={() => setLines(lines.filter((_, j) => j !== i))}>
                  {t.my.removeItem}
                </Button>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
      {addresses.state.status === "ready" && addresses.state.data.length > 0 ? (
        <label className="block text-sm text-ink-soft">
          <span className="mb-1 block">{t.my.deliverTo}</span>
          <select
            value={addressId}
            onChange={(event) => setAddressId(event.target.value)}
            className="block w-full rounded-md border border-line bg-velvet-low px-3 py-2 text-base text-ink"
          >
            <option value="">{t.my.keepAddress}</option>
            {addresses.state.data.map((address) => (
              <option key={address.id} value={address.id}>
                {address.label ? `${address.label} — ` : ""}
                {address.street}, {address.area.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <Button type="submit" variant="primary" disabled={pending}>
        {t.my.proposeChange}
      </Button>
    </form>
  );
}

function RevisionPanel({
  revision,
  pending,
  onConfirm,
}: {
  revision: Revision;
  pending: boolean;
  onConfirm: () => void;
}) {
  const t = useT();
  const lang = useLang();
  return (
    <section className="space-y-3 rounded-xl border border-plum bg-velvet-low p-5">
      <h3 className={heading}>{t.my.revision}</h3>
      <ul className="space-y-1 text-sm">
        {revision.proposed.items.map((item, i) => (
          <li key={i} className="flex justify-between gap-3">
            <span>
              {item.name}
              {item.variantName ? ` — ${item.variantName}` : ""} × {item.quantity}
            </span>
            <Money value={item.lineTotal} />
          </li>
        ))}
      </ul>
      <p className="text-sm text-ink-soft">
        {addressLine(revision.proposed.shippingAddress, lang)}
      </p>
      {revision.proposed.discountDropped ? (
        <Notice tone="info">{t.my.discountDropped}</Notice>
      ) : null}
      <dl className="space-y-1 text-sm">
        <Row label={t.my.oldTotal} value={revision.oldTotal} />
        <Row label={t.cartPage.shipping} value={revision.proposed.shippingFee} />
        <Row label={t.my.newTotal} value={revision.newTotal} strong />
        <Row label={t.checkout.payOnDelivery} value={revision.proposed.codAmount} />
      </dl>
      <p className="text-xs text-ink-soft">
        {t.my.revisionExpires.replace("{date}", formatDate(revision.expiresAt, lang, true))}
      </p>
      <Button variant="primary" disabled={pending} onClick={onConfirm}>
        {t.my.confirmChange}
      </Button>
    </section>
  );
}
