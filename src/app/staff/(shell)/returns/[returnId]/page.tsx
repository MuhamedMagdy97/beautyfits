"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import type { AdminReturnView } from "@/server/modules/returns/returns-service";
import type { ShippingCompanyView } from "@/server/modules/shipping/shipping-service";
import {
  Button,
  Card,
  formatDate,
  Guard,
  Input,
  Loaded,
  PageTitle,
  Select,
  StatusBadge,
  Table,
  useAction,
  useApiData,
  useCan,
} from "../../../_components/catalog-ui";
import { submit } from "../../../_components/ui";
import { staffPost } from "../../../_lib/api";
import { field } from "../../../_lib/forms";
import { returnStep } from "../../../_lib/orders";
import { snapshotName } from "../../../_lib/purchasing";
import { ordersError, useOrdersT } from "../../../_lib/orders-i18n";
import { InspectionForm } from "./inspection";

/**
 * One return (TASK-054): the customer's claim and photos, lines with their
 * inspection, status history, and the staff step of its status (approve or
 * reject, carrier pickup, receive, start inspection, inspect each line).
 * Completion and the refund are TASK-040/041 and not offered here.
 */
export default function ReturnPage() {
  return (
    <Guard anyOf={["RETURNS_VIEW"]}>
      <Return />
    </Guard>
  );
}

function Return() {
  const { returnId } = useParams<{ returnId: string }>();
  const { o } = useOrdersT();
  const { state, reload } = useApiData<AdminReturnView>(`/api/v1/admin/returns/${returnId}`);
  return (
    <Loaded load={state} reload={reload}>
      {(item) => (
        <>
          <Link href="/staff/returns" className="text-sm text-plum hover:underline">
            ← {o.returns}
          </Link>
          <PageTitle
            aside={<StatusBadge status={item.status} label={o.returnStatuses[item.status]} />}
          >
            {item.returnNumber}
          </PageTitle>
          <Summary item={item} />
          {item.status === "PENDING_APPROVAL" ? <ReviewCard item={item} onChange={reload} /> : null}
          {item.status === "APPROVED" ? <PickupCard item={item} onChange={reload} /> : null}
          <StepCard key={item.status} item={item} onChange={reload} />
          <Lines item={item} onChange={reload} />
          <Evidence item={item} />
          <History item={item} />
        </>
      )}
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

function Summary({ item }: { item: AdminReturnView }) {
  const { o } = useOrdersT();
  const can = useCan();
  const dates: [string, string | null][] = [
    [o.createdAt, item.createdAt],
    [o.approvedAt, item.approvedAt],
    [o.rejectedAt, item.rejectedAt],
    [o.receivedAt, item.receivedAt],
    [o.cancelledAt, item.cancelledAt],
  ];
  return (
    <Card>
      <dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
        <Row label={o.order}>
          {can("ORDERS_VIEW") ? (
            <Link href={`/staff/orders/${item.orderId}`} className="text-plum hover:underline">
              <span dir="ltr">{item.orderNumber}</span>
            </Link>
          ) : (
            <span dir="ltr">{item.orderNumber}</span>
          )}
        </Row>
        {item.customerId && can("CUSTOMER_VIEW") ? (
          <Row label={o.customer}>
            <Link
              href={`/staff/customers/${item.customerId}`}
              className="text-plum hover:underline"
            >
              {o.details}
            </Link>
          </Row>
        ) : null}
        <Row label={o.claimType}>{o.claimTypes[item.claimType] ?? item.claimType}</Row>
        {dates
          .filter(([, value]) => value)
          .map(([label, value]) => (
            <Row key={label} label={label}>
              {formatDate(value!)}
            </Row>
          ))}
        {item.pickup ? (
          <Row label={o.pickup}>
            {item.pickup.shippingCompany.name}
            {item.pickup.trackingNumber ? (
              <span className="block font-normal" dir="ltr">
                {o.tracking}: {item.pickup.trackingNumber}
              </span>
            ) : null}
            <span className="block font-normal">
              {o.feePayer}: {o.feePayers[item.pickup.feePayer] ?? item.pickup.feePayer}
            </span>
          </Row>
        ) : null}
      </dl>
      <div className="mt-4 text-sm">
        <p className="text-ink-soft">{o.customerReason}</p>
        <p className="whitespace-pre-line">{item.reason}</p>
        {item.resubmittedFromReturnId ? (
          <Link
            href={`/staff/returns/${item.resubmittedFromReturnId}`}
            className="mt-2 block text-plum hover:underline"
          >
            {o.resubmittedFrom}
          </Link>
        ) : null}
        {item.rejectionReason ? (
          <p className="mt-2">
            <span className="text-ink-soft">{o.rejectionReason}: </span>
            {item.rejectionReason}
          </p>
        ) : null}
      </div>
    </Card>
  );
}

function ReviewCard({ item, onChange }: { item: AdminReturnView; onChange: () => void }) {
  const { t, c, o } = useOrdersT();
  const can = useCan();
  const { run, pending, notice } = useAction(onChange, (error) => ordersError(t, c, o, error));
  if (!can("APPROVE_RETURN")) {
    return null;
  }
  const base = `/api/v1/admin/returns/${item.id}`;
  return (
    <Card title={o.review}>
      {notice}
      <form
        className="mb-4 flex flex-wrap items-end gap-3"
        onSubmit={submit(
          (form) => void run(() => staffPost(`${base}/approve`, { note: field(form, "note") })),
        )}
      >
        <div className="min-w-56 flex-1">
          <Input label={o.approveNote} name="note" maxLength={1000} />
        </div>
        <Button type="submit" disabled={pending}>
          {o.approve}
        </Button>
      </form>
      <form
        className="flex flex-wrap items-end gap-3 border-t border-line pt-4"
        onSubmit={submit(
          (form) => void run(() => staffPost(`${base}/reject`, { reason: field(form, "reason") })),
        )}
      >
        <div className="min-w-56 flex-1">
          <Input label={o.rejectReason} name="reason" required maxLength={1000} />
        </div>
        <Button type="submit" variant="danger" disabled={pending}>
          {o.reject}
        </Button>
      </form>
    </Card>
  );
}

function PickupCard({ item, onChange }: { item: AdminReturnView; onChange: () => void }) {
  const { t, c, o } = useOrdersT();
  const can = useCan();
  const { run, pending, notice } = useAction(onChange, (error) => ordersError(t, c, o, error));
  if (!can("MANAGE_RETURNS")) {
    return null;
  }
  return (
    <Card title={o.pickup}>
      {notice}
      {can("SHIPPING_VIEW") ? (
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={submit(
            (form) =>
              void run(() =>
                staffPost(`/api/v1/admin/returns/${item.id}/pickup`, {
                  shippingCompanyId: field(form, "shippingCompanyId"),
                  trackingNumber: field(form, "trackingNumber"),
                  feePayer: field(form, "feePayer"),
                  notes: field(form, "notes"),
                }),
              ),
          )}
        >
          <CarrierSelect />
          <Input label={o.trackingOptional} name="trackingNumber" dir="ltr" maxLength={100} />
          <Select label={o.feePayer} name="feePayer" defaultValue="CUSTOMER">
            {Object.entries(o.feePayers).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
          <Input label={o.notesOptional} name="notes" maxLength={1000} />
          <div>
            <Button type="submit" disabled={pending}>
              {o.requestPickup}
            </Button>
          </div>
        </form>
      ) : (
        <p className="text-sm text-ink-soft">{o.carriersNeedPermission}</p>
      )}
    </Card>
  );
}

function CarrierSelect() {
  const { o } = useOrdersT();
  const carriers = useApiData<ShippingCompanyView[]>(
    "/api/v1/admin/shipping/companies?status=ACTIVE",
  );
  return (
    <Select label={o.carrier} name="shippingCompanyId" required defaultValue="">
      <option value="" disabled>
        {o.noCarrier}
      </option>
      {(carriers.state.status === "ready" ? carriers.state.data : []).map((carrier) => (
        <option key={carrier.id} value={carrier.id}>
          {carrier.name}
        </option>
      ))}
    </Select>
  );
}

/** Receive (`PICKUP_SCHEDULED`) and start inspection (`RECEIVED`), each with optional notes. */
function StepCard({ item, onChange }: { item: AdminReturnView; onChange: () => void }) {
  const { t, c, o } = useOrdersT();
  const can = useCan();
  const { run, pending, notice } = useAction(onChange, (error) => ordersError(t, c, o, error));
  const step = returnStep(item.status);
  if (!step || !can(step.permission)) {
    return null;
  }
  const label = step.path === "receive" ? o.receive : o.startInspection;
  return (
    <Card title={o.actions}>
      {notice}
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={submit(
          (form) =>
            void run(() =>
              staffPost(`/api/v1/admin/returns/${item.id}/${step.path}`, {
                notes: field(form, "notes"),
              }),
            ),
        )}
      >
        <div className="min-w-56 flex-1">
          <Input label={o.notesOptional} name="notes" maxLength={1000} />
        </div>
        <Button type="submit" disabled={pending}>
          {label}
        </Button>
      </form>
    </Card>
  );
}

function Lines({ item, onChange }: { item: AdminReturnView; onChange: () => void }) {
  const { o, english } = useOrdersT();
  const can = useCan();
  const inspecting = item.status === "INSPECTING" && can("INSPECT_RETURN");
  return (
    <Card title={o.items}>
      <ul className="divide-y divide-line">
        {item.items.map((line) => (
          <li key={line.id} className="py-3 text-sm">
            <div className="flex flex-wrap justify-between gap-2">
              <span>
                <span className="font-semibold">{snapshotName(line.productName, english)}</span>
                {line.variantName ? (
                  <span className="text-ink-soft">
                    {" "}
                    · {snapshotName(line.variantName, english)}
                  </span>
                ) : null}
                <span className="block text-xs text-ink-soft" dir="ltr">
                  {line.sku}
                </span>
              </span>
              <span className="text-ink-soft">
                {o.ordered}: {line.orderedQuantity} · {o.requested}:{" "}
                <span className="font-semibold text-ink">{line.requestedQuantity}</span>
              </span>
            </div>
            {line.inspection ? (
              <div className="mt-2 rounded-lg bg-velvet-low p-3">
                <p className="mb-1 text-xs text-ink-soft">
                  {o.inspectedAt}: {formatDate(line.inspection.inspectedAt)}
                </p>
                <ul>
                  {line.inspection.outcomes.map((outcome, index) => (
                    <li key={index}>
                      {outcome.quantity} × {o.results[outcome.result] ?? outcome.result} (
                      {o.conditions[outcome.condition] ?? outcome.condition})
                      {outcome.notes ? (
                        <span className="text-ink-soft"> — {outcome.notes}</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
                <Photos photos={line.inspection.evidence} />
              </div>
            ) : inspecting ? (
              <InspectionForm line={line} onChange={onChange} />
            ) : (
              <p className="mt-1 text-xs text-ink-soft">{o.notInspected}</p>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Photos({ photos }: { photos: { mediaAssetId: string; url: string }[] }) {
  if (photos.length === 0) {
    return null;
  }
  return (
    <ul className="mt-2 flex flex-wrap gap-2">
      {photos.map((photo) => (
        <li key={photo.mediaAssetId}>
          <a href={photo.url} target="_blank" rel="noreferrer">
            {/* eslint-disable-next-line @next/next/no-img-element -- staff-only API file, needs the session cookie */}
            <img src={photo.url} alt="" className="size-24 rounded object-cover" />
          </a>
        </li>
      ))}
    </ul>
  );
}

function Evidence({ item }: { item: AdminReturnView }) {
  const { o } = useOrdersT();
  return (
    <Card title={o.evidence}>
      {item.evidence.length === 0 ? (
        <p className="text-sm text-ink-soft">{o.noEvidence}</p>
      ) : (
        <Photos photos={item.evidence} />
      )}
    </Card>
  );
}

function History({ item }: { item: AdminReturnView }) {
  const { c, o } = useOrdersT();
  const label = (status: string) => o.returnStatuses[status] ?? status;
  return (
    <Card title={o.statusHistory}>
      <Table head={[c.status, o.by, o.reason, o.at]}>
        {item.statusHistory.map((entry, index) => (
          <tr key={index}>
            <td className="px-3 py-2">
              {entry.fromStatus ? `${label(entry.fromStatus)} → ` : ""}
              {label(entry.toStatus)}
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
