"use client";

import type { AdminOrderView } from "@/server/modules/orders/orders-service";
import type { ShippingCompanyView } from "@/server/modules/shipping/shipping-service";
import {
  Button,
  Card,
  Input,
  Select,
  useAction,
  useApiData,
  useCan,
} from "../../../../_components/catalog-ui";
import { submit } from "../../../../_components/ui";
import { staffPost } from "../../../../_lib/api";
import { field } from "../../../../_lib/forms";
import { usePurchasingT } from "../../../../_lib/purchasing-i18n";

/** Carrier assignment, handoff and shipping cancellation cards (TASK-034, TASK-036), also on the order screen (TASK-054). */

/** Order states before the carrier handoff, where a carrier can still be assigned (TASK-034). */
export const BEFORE_HANDOFF = [
  "PENDING_CONFIRMATION",
  "NEW",
  "CONFIRMED",
  "PREPARING",
  "READY_FOR_SHIPMENT",
];
/** Shipment states in which the carrier still has the parcel (TASK-036, R3). */
export const CANCELLABLE = ["SHIPPED", "OUT_FOR_DELIVERY", "DELIVERY_FAILED"];

export function HandoffCard({ order, onChange }: { order: AdminOrderView; onChange: () => void }) {
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
        {/* Remount once the carriers load: a default value only selects an option that already exists. */}
        <Select
          key={carriers.state.status}
          label={p.carrier}
          name="shippingCompanyId"
          required
          defaultValue={current ?? ""}
        >
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

export function CancellationCard({ orderId, onChange }: { orderId: string; onChange: () => void }) {
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
