"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import type { AdminOrderView } from "@/server/modules/orders/orders-service";
import {
  Card,
  Guard,
  Loaded,
  PageTitle,
  StatusBadge,
  useApiData,
} from "../../../../_components/catalog-ui";
import { usePurchasingT } from "../../../../_lib/purchasing-i18n";
import { BEFORE_HANDOFF, CANCELLABLE, CancellationCard, HandoffCard } from "./handoff";
import { ShipmentCard } from "./shipment";

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
