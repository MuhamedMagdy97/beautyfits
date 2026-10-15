"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import type { AdminOrderView } from "@/server/modules/orders/orders-service";
import type { ShippingCompanyView } from "@/server/modules/shipping/shipping-service";
import {
  Button,
  Card,
  Guard,
  Input,
  Loaded,
  PageTitle,
  Select,
  StatusBadge,
  useAction,
  useApiData,
  useCan,
} from "../../../../_components/catalog-ui";
import { submit } from "../../../../_components/ui";
import { staffPost } from "../../../../_lib/api";
import { field } from "../../../../_lib/forms";
import { usePurchasingT } from "../../../../_lib/purchasing-i18n";
import { ShipmentCard } from "./shipment";

/** Order states before the carrier handoff, where a carrier can still be assigned (TASK-034). */
const BEFORE_HANDOFF = [
  "PENDING_CONFIRMATION",
  "NEW",
  "CONFIRMED",
  "PREPARING",
  "READY_FOR_SHIPMENT",
];
/** Shipment states in which the carrier still has the parcel (TASK-036, R3). */
const CANCELLABLE = ["SHIPPED", "OUT_FOR_DELIVERY", "DELIVERY_FAILED"];

/** Shipping of one order: carrier, handoff, tracking, delivery events, way back (TASK-034..036). */
export default function OrderShippingPage() {
  return (
    <Guard anyOf={["ORDERS_VIEW"]}>
      <OrderShipping />
    </Guard>
  );
}

function OrderShipping() {
  const { p } = usePurchasingT();
  const { orderId } = useParams<{ orderId: string }>();
  const { state, reload } = useApiData<AdminOrderView>(`/api/v1/admin/orders/${orderId}`);

  return (
    <Loaded load={state} reload={reload}>
      {(order) => {
        const latest = order.shipments.at(-1);
        return (
          <>
            <Link href="/staff/shipping" className="text-sm text-plum hover:underline">
              ← {p.shipments}
            </Link>
            <PageTitle aside={<StatusBadge status={order.status} />}>{order.orderNumber}</PageTitle>
            <Card>
              <dl className="grid gap-3 text-sm sm:grid-cols-3">
                <div>
                  <dt className="text-ink-soft">{p.customer}</dt>
                  <dd className="font-semibold">
                    {order.customer.fullName}
                    {order.customer.phone ? (
                      <span className="block font-normal" dir="ltr">
                        {order.customer.phone}
                      </span>
                    ) : null}
                  </dd>
                </div>
                <div>
                  <dt className="text-ink-soft">{p.carrier}</dt>
                  <dd className="font-semibold">{order.shipping.company?.name ?? p.noCarrier}</dd>
                </div>
              </dl>
            </Card>
            {BEFORE_HANDOFF.includes(order.status) ? (
              <HandoffCard order={order} onChange={reload} />
            ) : null}
            {order.status === "SHIPPED" &&
            latest &&
            CANCELLABLE.includes(latest.status) &&
            !latest.cancellationRequestedAt ? (
              <CancellationCard orderId={order.id} onChange={reload} />
            ) : null}
            {order.shipments.length === 0 ? (
              <p className="text-sm text-ink-soft">{p.noShipments}</p>
            ) : null}
            {order.shipments.map((shipment) => (
              <ShipmentCard key={shipment.id} order={order} shipment={shipment} onChange={reload} />
            ))}
          </>
        );
      }}
    </Loaded>
  );
}

function HandoffCard({ order, onChange }: { order: AdminOrderView; onChange: () => void }) {
  const { p } = usePurchasingT();
  const can = useCan();
  const { run, pending, notice } = useAction(onChange);
  const assign = can("ASSIGN_SHIPPING") && can("SHIPPING_VIEW");
  const ship = can("MARK_AS_SHIPPED") && order.status === "READY_FOR_SHIPMENT";
  if (!assign && !ship) {
    return null;
  }
  return (
    <Card title={p.shipping}>
      {notice}
      {assign ? (
        <AssignForm
          current={order.shipping.company?.id}
          pending={pending}
          onAssign={(shippingCompanyId) =>
            void run(() =>
              staffPost(`/api/v1/admin/orders/${order.id}/assign-shipping`, { shippingCompanyId }),
            )
          }
        />
      ) : null}
      {ship ? (
        <form
          className="mt-4 flex flex-wrap items-end gap-3"
          onSubmit={submit(
            (form) =>
              void run(() =>
                staffPost(`/api/v1/admin/orders/${order.id}/mark-shipped`, {
                  trackingNumber: field(form, "trackingNumber"),
                }),
              ),
          )}
        >
          <div className="min-w-56 flex-1">
            <Input label={p.trackingOptional} name="trackingNumber" dir="ltr" maxLength={100} />
          </div>
          <Button type="submit" disabled={pending}>
            {p.markShipped}
          </Button>
        </form>
      ) : null}
    </Card>
  );
}

function AssignForm({
  current,
  pending,
  onAssign,
}: {
  current: string | undefined;
  pending: boolean;
  onAssign: (id: string) => void;
}) {
  const { p } = usePurchasingT();
  const carriers = useApiData<ShippingCompanyView[]>(
    "/api/v1/admin/shipping/companies?status=ACTIVE",
  );
  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={submit((form) => {
        const id = field(form, "shippingCompanyId");
        if (id) onAssign(id);
      })}
    >
      <div className="min-w-56 flex-1">
        <Select label={p.carrier} name="shippingCompanyId" required defaultValue={current ?? ""}>
          <option value="" disabled>
            {p.noCarrier}
          </option>
          {(carriers.state.status === "ready" ? carriers.state.data : []).map((carrier) => (
            <option key={carrier.id} value={carrier.id}>
              {carrier.name}
            </option>
          ))}
        </Select>
      </div>
      <Button type="submit" variant="plain" disabled={pending}>
        {p.assignCarrier}
      </Button>
    </form>
  );
}

function CancellationCard({ orderId, onChange }: { orderId: string; onChange: () => void }) {
  const { c, p } = usePurchasingT();
  const can = useCan();
  const { run, pending, notice } = useAction(onChange);
  if (!can("REQUEST_SHIPPING_CANCELLATION")) {
    return null;
  }
  return (
    <Card title={p.requestCancellation}>
      <p className="mb-3 text-sm text-ink-soft">{p.requestCancellationHint}</p>
      {notice}
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={submit(
          (form) =>
            void run(() =>
              staffPost(`/api/v1/admin/orders/${orderId}/request-shipping-cancellation`, {
                reason: field(form, "reason"),
              }),
            ),
        )}
      >
        <div className="min-w-56 flex-1">
          <Input label={c.reasonOptional} name="reason" maxLength={500} />
        </div>
        <Button type="submit" variant="danger" disabled={pending}>
          {p.requestCancellation}
        </Button>
      </form>
    </Card>
  );
}
