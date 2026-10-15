"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import type { AdminOrderView } from "@/server/modules/orders/orders-service";
import {
  Button,
  Card,
  formatDate,
  Guard,
  Input,
  Loaded,
  PageTitle,
  StatusBadge,
  Table,
  useAction,
  useApiData,
  useCan,
} from "../../../_components/catalog-ui";
import { submit } from "../../../_components/ui";
import { staffPost } from "../../../_lib/api";
import { field } from "../../../_lib/forms";
import { formatPiastres } from "../../../_lib/money";
import { orderStep, snapshotPlace } from "../../../_lib/orders";
import { snapshotName } from "../../../_lib/purchasing";
import { ordersError, useOrdersT } from "../../../_lib/orders-i18n";
import {
  BEFORE_HANDOFF,
  CANCELLABLE,
  CancellationCard,
  HandoffCard,
} from "../../shipping/orders/[orderId]/handoff";

/** One order (TASK-054): details, items, amounts, history and the staff actions of its status. */
export default function OrderPage() {
  return (
    <Guard anyOf={["ORDERS_VIEW"]}>
      <Order />
    </Guard>
  );
}

function Order() {
  const { orderId } = useParams<{ orderId: string }>();
  const { o } = useOrdersT();
  const { state, reload } = useApiData<AdminOrderView>(`/api/v1/admin/orders/${orderId}`);
  return (
    <Loaded load={state} reload={reload}>
      {(order) => {
        const latest = order.shipments.at(-1);
        return (
          <>
            <Link href="/staff/orders" className="text-sm text-plum hover:underline">
              ← {o.orders}
            </Link>
            <PageTitle aside={<StatusBadge status={order.status} />}>{order.orderNumber}</PageTitle>
            <Summary order={order} />
            <ActionsCard order={order} onChange={reload} />
            {BEFORE_HANDOFF.includes(order.status) ? (
              <HandoffCard order={order} onChange={reload} />
            ) : null}
            {order.status === "SHIPPED" &&
            latest &&
            CANCELLABLE.includes(latest.status) &&
            !latest.cancellationRequestedAt ? (
              <CancellationCard orderId={order.id} onChange={reload} />
            ) : null}
            <Items order={order} />
            <Amounts order={order} />
            {order.codConfirmationRequired ? <CodCard order={order} /> : null}
            <Revisions order={order} />
            <History order={order} />
          </>
        );
      }}
    </Loaded>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-ink-soft">{label}</dt>
      <dd className="font-semibold">{children}</dd>
    </div>
  );
}

function Summary({ order }: { order: AdminOrderView }) {
  const { c, o, english } = useOrdersT();
  const can = useCan();
  const { customer } = order;
  const address = order.shippingAddress as Record<string, unknown>;
  const street = [
    address.street,
    address.building,
    address.floor,
    address.apartment,
    address.city,
    address.landmark,
  ]
    .filter((part) => typeof part === "string" && part)
    .join(c.listSeparator);
  return (
    <Card>
      <dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
        <Row label={o.customer}>
          {customer.customerId && can("CUSTOMER_VIEW") ? (
            <Link
              href={`/staff/customers/${customer.customerId}`}
              className="text-plum hover:underline"
            >
              {customer.fullName}
            </Link>
          ) : (
            customer.fullName
          )}
          {customer.customerId ? null : (
            <span className="font-normal text-ink-soft"> ({o.guest})</span>
          )}
          {customer.phone ? (
            <span className="block font-normal" dir="ltr">
              {customer.phone}
            </span>
          ) : null}
          {customer.email ? (
            <span className="block font-normal" dir="ltr">
              {customer.email}
            </span>
          ) : null}
          {customer.phone === undefined ? (
            <span className="block text-xs font-normal text-ink-soft">{o.contactHidden}</span>
          ) : null}
        </Row>
        <Row label={o.shippingAddress}>
          {[snapshotPlace(address.governorate, english), snapshotPlace(address.area, english)]
            .filter(Boolean)
            .join(" / ")}
          {street ? <span className="block font-normal">{street}</span> : null}
          {typeof address.recipientName === "string" ? (
            <span className="block font-normal">
              {address.recipientName}
              {typeof address.phone === "string" ? <span dir="ltr"> · {address.phone}</span> : null}
            </span>
          ) : null}
          {typeof address.notes === "string" && address.notes ? (
            <span className="block font-normal text-ink-soft">{address.notes}</span>
          ) : null}
        </Row>
        <Row label={o.paymentMethod}>
          {o.paymentMethods[order.paymentMethod] ?? order.paymentMethod}
        </Row>
        <Row label={o.createdAt}>{formatDate(order.createdAt)}</Row>
        <Row label={o.carrier}>
          {order.shipping.company?.name ?? o.noCarrier}
          <Link
            href={`/staff/shipping/orders/${order.id}`}
            className="block font-normal text-plum hover:underline"
          >
            {o.openShipping} →
          </Link>
        </Row>
      </dl>
    </Card>
  );
}

function ActionsCard({ order, onChange }: { order: AdminOrderView; onChange: () => void }) {
  const { t, c, o } = useOrdersT();
  const can = useCan();
  const { run, pending, notice } = useAction(onChange, (error) => ordersError(t, c, o, error));
  const step = orderStep(order.status);
  const stepAllowed = step !== null && can(step.permission);
  const cancel = can("CANCEL_ORDER") && BEFORE_HANDOFF.includes(order.status);
  if (!stepAllowed && !cancel) {
    return null;
  }
  const labels: Record<string, string> = {
    "record-phone-confirmation": o.recordPhoneConfirmation,
    confirm: o.confirm,
    "start-preparing": o.startPreparing,
    "mark-ready-for-shipment": o.markReady,
  };
  return (
    <Card title={o.actions}>
      {notice}
      {stepAllowed ? (
        <div className="mb-4">
          {step.path === "record-phone-confirmation" ? (
            <p className="mb-2 text-sm text-ink-soft">{o.recordPhoneHint}</p>
          ) : null}
          <Button
            disabled={pending}
            onClick={() =>
              void run(() => staffPost(`/api/v1/admin/orders/${order.id}/${step.path}`))
            }
          >
            {labels[step.path]}
          </Button>
        </div>
      ) : null}
      {cancel ? (
        <form
          className="flex flex-wrap items-end gap-3 border-t border-line pt-4"
          onSubmit={submit(
            (form) =>
              void run(() =>
                staffPost(`/api/v1/admin/orders/${order.id}/cancel`, {
                  reason: field(form, "reason"),
                }),
              ),
          )}
        >
          <p className="w-full text-sm text-ink-soft">{o.cancelHint}</p>
          <div className="min-w-56 flex-1">
            <Input label={o.cancelReason} name="reason" required maxLength={500} />
          </div>
          <Button type="submit" variant="danger" disabled={pending}>
            {o.cancelOrder}
          </Button>
        </form>
      ) : null}
    </Card>
  );
}

function Items({ order }: { order: AdminOrderView }) {
  const { o, english } = useOrdersT();
  const costs = order.items.some((item) => item.unitCostAtSale !== undefined);
  return (
    <Card title={o.items}>
      <Table
        head={[
          o.product,
          o.sku,
          o.quantity,
          o.unitPrice,
          o.lineDiscount,
          o.lineTotal,
          ...(costs ? [o.unitCost] : []),
        ]}
      >
        {order.items.map((item) => (
          <tr key={item.id}>
            <td className="px-3 py-2">
              <div className="flex items-center gap-2">
                {item.image ? (
                  // eslint-disable-next-line @next/next/no-img-element -- staff-only API file, needs the session cookie
                  <img src={item.image.url} alt="" className="size-10 rounded object-cover" />
                ) : null}
                <span>
                  {snapshotName(item.name, english)}
                  {item.variantName ? (
                    <span className="block text-xs text-ink-soft">
                      {snapshotName(item.variantName, english)}
                    </span>
                  ) : null}
                </span>
              </div>
            </td>
            <td className="px-3 py-2" dir="ltr">
              {item.sku}
            </td>
            <td className="px-3 py-2">{item.quantity}</td>
            <td className="px-3 py-2">{formatPiastres(item.unitPrice)}</td>
            <td className="px-3 py-2">{formatPiastres(item.discountAmount)}</td>
            <td className="px-3 py-2">{formatPiastres(item.lineTotal)}</td>
            {costs ? (
              <td className="px-3 py-2">{formatPiastres(item.unitCostAtSale) ?? "—"}</td>
            ) : null}
          </tr>
        ))}
      </Table>
    </Card>
  );
}

function Amounts({ order }: { order: AdminOrderView }) {
  const { o } = useOrdersT();
  const discount = order.discount as { code?: string | null } | null;
  const rows: [string, number][] = [
    [o.subtotal, order.subtotal],
    [o.discountTotal, order.discountTotal],
    [o.shippingFee, order.shippingFee],
    [o.total, order.total],
    [o.walletReserved, order.walletAmountReserved],
    [o.walletCaptured, order.walletAmountCaptured],
    [o.codAmount, order.codAmount],
  ];
  return (
    <Card title={o.amounts}>
      <dl className="grid gap-3 text-sm sm:grid-cols-4">
        {rows.map(([label, value]) => (
          <Row key={label} label={label}>
            {formatPiastres(value)}
          </Row>
        ))}
        {discount?.code ? (
          <Row label={o.discountCode}>
            <span dir="ltr">{discount.code}</span>
          </Row>
        ) : null}
      </dl>
      {order.taxIncluded ? <p className="mt-3 text-xs text-ink-soft">{o.taxIncluded}</p> : null}
    </Card>
  );
}

function CodCard({ order }: { order: AdminOrderView }) {
  const { o } = useOrdersT();
  const cod = order.codConfirmation;
  return (
    <Card title={o.codConfirmation}>
      <dl className="grid gap-3 text-sm sm:grid-cols-3">
        <Row label={o.codSource}>
          {cod.source ? (o.codSources[cod.source] ?? cod.source) : o.notConfirmed}
          {cod.confirmedAt ? (
            <span className="block font-normal">{formatDate(cod.confirmedAt)}</span>
          ) : null}
        </Row>
        {cod.deadlineAt ? <Row label={o.codDeadline}>{formatDate(cod.deadlineAt)}</Row> : null}
        <Row label={o.reminders}>{cod.reminderCount}</Row>
      </dl>
    </Card>
  );
}

function Revisions({ order }: { order: AdminOrderView }) {
  const { o } = useOrdersT();
  if (order.revisions.length === 0) {
    return null;
  }
  return (
    <Card title={o.revisions}>
      <Table head={[o.revision, "", o.oldTotal, o.newTotal, o.createdAt]}>
        {order.revisions.map((revision) => (
          <tr key={revision.id}>
            <td className="px-3 py-2">#{revision.revisionNumber}</td>
            <td className="px-3 py-2">{o.revisionStatuses[revision.status] ?? revision.status}</td>
            <td className="px-3 py-2">{formatPiastres(revision.oldTotal)}</td>
            <td className="px-3 py-2">{formatPiastres(revision.newTotal)}</td>
            <td className="px-3 py-2">{formatDate(revision.createdAt)}</td>
          </tr>
        ))}
      </Table>
    </Card>
  );
}

function History({ order }: { order: AdminOrderView }) {
  const { c, o } = useOrdersT();
  return (
    <Card title={o.statusHistory}>
      <Table head={[c.status, o.by, o.reason, o.at]}>
        {order.statusHistory.map((entry, index) => (
          <tr key={index}>
            <td className="px-3 py-2">
              {entry.fromStatus ? `${c.statuses[entry.fromStatus] ?? entry.fromStatus} → ` : ""}
              {c.statuses[entry.toStatus] ?? entry.toStatus}
            </td>
            <td className="px-3 py-2">
              {o.actorTypes[entry.changedByType] ?? entry.changedByType}
            </td>
            <td className="px-3 py-2">{entry.reason ?? "—"}</td>
            <td className="px-3 py-2">{formatDate(entry.createdAt)}</td>
          </tr>
        ))}
      </Table>
    </Card>
  );
}
