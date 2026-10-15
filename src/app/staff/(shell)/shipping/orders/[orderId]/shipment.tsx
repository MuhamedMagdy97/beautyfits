"use client";

import type { AdminOrderView } from "@/server/modules/orders/orders-service";
import {
  Button,
  Card,
  formatDate,
  Input,
  Select,
  StatusBadge,
  Table,
  TextArea,
  useAction,
  useCan,
} from "../../../../_components/catalog-ui";
import { submit } from "../../../../_components/ui";
import { staffPost } from "../../../../_lib/api";
import { field } from "../../../../_lib/forms";
import { countField, snapshotName } from "../../../../_lib/purchasing";
import { usePurchasingT } from "../../../../_lib/purchasing-i18n";

type Shipment = AdminOrderView["shipments"][number];

/**
 * Manual status updates offered per shipment status, as listed in API §16
 * ("TASK-034..036 Amendments"). `DELIVERED` also needs `MARK_AS_DELIVERED`;
 * sending a parcel back before a failed attempt needs a cancellation request.
 * The API decides.
 */
const NEXT: Record<string, string[]> = {
  SHIPPED: ["OUT_FOR_DELIVERY", "RETURN_TO_SENDER"],
  OUT_FOR_DELIVERY: ["DELIVERED", "DELIVERY_FAILED", "RETURN_TO_SENDER"],
  DELIVERY_FAILED: ["OUT_FOR_DELIVERY", "RETURN_TO_SENDER"],
  RETURN_TO_SENDER: ["RETURNED"],
};

/** One carrier handoff: details, events, tracking, status, returned-parcel inspection. */
export function ShipmentCard({
  order,
  shipment,
  onChange,
}: {
  order: AdminOrderView;
  shipment: Shipment;
  onChange: () => void;
}) {
  const { c, p } = usePurchasingT();
  const can = useCan();
  const next = (NEXT[shipment.status] ?? []).filter(
    (status) => status !== "DELIVERED" || can("MARK_AS_DELIVERED"),
  );
  const manage = can("MANAGE_SHIPMENT");
  const facts: [string, string][] = [
    [p.carrier, shipment.company.name],
    [p.trackingNumber, shipment.trackingNumber ?? "—"],
    [p.shippedAt, formatDate(shipment.shippedAt)],
    [p.attempts, String(shipment.attemptCount)],
  ];
  if (shipment.deliveredAt) facts.push([p.deliveredAt, formatDate(shipment.deliveredAt)]);
  if (shipment.cancellationRequestedAt) {
    facts.push([p.cancellationRequested, formatDate(shipment.cancellationRequestedAt)]);
  }
  if (shipment.returnedAt) facts.push([p.returnedAt, formatDate(shipment.returnedAt)]);
  if (shipment.inspectedAt) facts.push([p.inspectedAt, formatDate(shipment.inspectedAt)]);

  return (
    <Card title={`${p.shipments} · ${shipment.company.code}`}>
      <div className="mb-4">
        <StatusBadge status={shipment.status} />
      </div>
      <dl className="mb-4 grid gap-3 text-sm sm:grid-cols-4">
        {facts.map(([label, value]) => (
          <div key={label}>
            <dt className="text-ink-soft">{label}</dt>
            <dd className="font-semibold">{value}</dd>
          </div>
        ))}
      </dl>
      <h3 className="mb-2 text-sm font-semibold text-ink">{p.events}</h3>
      <Table head={[c.date, p.events, p.location, p.notes]}>
        {shipment.events.map((event) => (
          <tr key={event.id}>
            <td className="px-3 py-2">{formatDate(event.at)}</td>
            <td className="px-3 py-2">{p.eventTypes[event.type] ?? event.type}</td>
            <td className="px-3 py-2">{event.location ?? "—"}</td>
            <td className="px-3 py-2">{event.notes ?? "—"}</td>
          </tr>
        ))}
      </Table>
      {manage && shipment.status !== "DELIVERED" && shipment.status !== "RETURNED" ? (
        <TrackingForm shipment={shipment} onChange={onChange} />
      ) : null}
      {manage && next.length > 0 ? (
        <StatusForm shipment={shipment} next={next} onChange={onChange} />
      ) : null}
      {can("INSPECT_RETURN") && shipment.status === "RETURNED" && !shipment.inspectedAt ? (
        <InspectForm order={order} shipment={shipment} onChange={onChange} />
      ) : null}
    </Card>
  );
}

const panel = "mt-4 rounded-lg border border-line bg-velvet-low p-4";

function TrackingForm({ shipment, onChange }: { shipment: Shipment; onChange: () => void }) {
  const { p } = usePurchasingT();
  const { run, pending, notice } = useAction(onChange);
  return (
    <div className={panel}>
      {notice}
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={submit(
          (form) =>
            void run(() =>
              staffPost(`/api/v1/admin/shipments/${shipment.id}/tracking`, {
                trackingNumber: field(form, "trackingNumber"),
              }),
            ),
        )}
      >
        <div className="min-w-56 flex-1">
          <Input
            key={shipment.trackingNumber}
            label={p.trackingNumber}
            name="trackingNumber"
            required
            dir="ltr"
            maxLength={100}
            defaultValue={shipment.trackingNumber ?? ""}
          />
        </div>
        <Button type="submit" variant="plain" disabled={pending}>
          {p.updateTracking}
        </Button>
      </form>
    </div>
  );
}

function StatusForm({
  shipment,
  next,
  onChange,
}: {
  shipment: Shipment;
  next: string[];
  onChange: () => void;
}) {
  const { c, p } = usePurchasingT();
  const { run, pending, notice } = useAction(onChange);
  return (
    <div className={panel}>
      {notice}
      <form
        className="grid gap-3 sm:grid-cols-3"
        onSubmit={submit(
          (form) =>
            void run(() =>
              staffPost(`/api/v1/admin/shipments/${shipment.id}/status`, {
                status: field(form, "status"),
                location: field(form, "location"),
                notes: field(form, "notes"),
              }),
            ),
        )}
      >
        <Select key={shipment.status} label={p.newStatus} name="status" defaultValue={next[0]}>
          {next.map((status) => (
            <option key={status} value={status}>
              {c.statuses[status] ?? status}
            </option>
          ))}
        </Select>
        <Input label={p.location} name="location" maxLength={200} />
        <Input label={p.notes} name="notes" maxLength={1000} />
        <div>
          <Button type="submit" disabled={pending}>
            {p.changeStatus}
          </Button>
        </div>
      </form>
    </div>
  );
}

function InspectForm({
  order,
  shipment,
  onChange,
}: {
  order: AdminOrderView;
  shipment: Shipment;
  onChange: () => void;
}) {
  const { p, english } = usePurchasingT();
  const { run, pending, notice, fail } = useAction(onChange);
  return (
    <div className={panel}>
      <h3 className="mb-1 text-sm font-semibold text-ink">{p.inspectReturn}</h3>
      <p className="mb-3 text-sm text-ink-soft">{p.inspectHint}</p>
      {notice}
      <form
        onSubmit={submit((form) => {
          const damaged: { orderItemId: string; quantity: number }[] = [];
          for (const item of order.items) {
            const quantity = countField(String(form.get(`damaged-${item.id}`) ?? ""));
            if (quantity === null) {
              fail(p.badCount);
              return;
            }
            if (quantity > 0) damaged.push({ orderItemId: item.id, quantity });
          }
          if (!window.confirm(p.inspectHint)) return;
          void run(() =>
            staffPost(`/api/v1/admin/shipments/${shipment.id}/inspect-return`, {
              damaged,
              notes: field(form, "notes"),
            }),
          );
        })}
      >
        <Table head={[p.sku, p.item, p.quantity, p.damagedInShipping]}>
          {order.items.map((item) => (
            <tr key={item.id}>
              <td className="px-3 py-2" dir="ltr">
                {item.sku}
              </td>
              <td className="px-3 py-2">{snapshotName(item.name, english)}</td>
              <td className="px-3 py-2">{item.quantity}</td>
              <td className="px-3 py-2">
                <input
                  name={`damaged-${item.id}`}
                  inputMode="numeric"
                  aria-label={`${p.damagedInShipping} ${item.sku}`}
                  className="w-20 rounded-md border border-line bg-white px-2 py-1 text-sm"
                />
              </td>
            </tr>
          ))}
        </Table>
        <div className="mt-3 grid gap-3">
          <TextArea label={p.notes} name="notes" maxLength={1000} />
          <div>
            <Button type="submit" variant="danger" disabled={pending}>
              {p.inspectReturn}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
