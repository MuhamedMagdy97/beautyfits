"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import type { PurchaseView } from "@/server/modules/purchasing/purchase-orders-service";
import type { PermissionCode } from "@/server/modules/rbac/catalog";
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
  TextArea,
  useAction,
  useApiData,
  useCan,
} from "../../../_components/catalog-ui";
import { Notice, submit } from "../../../_components/ui";
import { staffApi, staffPost } from "../../../_lib/api";
import { field } from "../../../_lib/forms";
import { formatPiastres } from "../../../_lib/money";
import { formatPurchaseLines } from "../../../_lib/purchasing";
import { fill, usePurchasingT } from "../../../_lib/purchasing-i18n";
import { purchaseItems } from "../lines";
import { InvoicesCard } from "./invoices";
import { ReceiptsCard, ReceiveCard } from "./receiving";
import { PurchaseReturnsCard } from "./returns";

/** One purchase order: lines, approval actions, receiving, invoices, returns (TASK-022..024). */
export default function PurchasePage() {
  return (
    <Guard anyOf={["PURCHASE_VIEW", "RECEIVE_PURCHASE"]}>
      <Purchase />
    </Guard>
  );
}

function Purchase() {
  const { p } = usePurchasingT();
  const can = useCan();
  const { id } = useParams<{ id: string }>();
  const { state, reload } = useApiData<PurchaseView>(`/api/v1/admin/purchases/${id}`);

  return (
    <Loaded load={state} reload={reload}>
      {(purchase) => (
        <>
          <Link href="/staff/purchases" className="text-sm text-plum hover:underline">
            ← {p.purchases}
          </Link>
          <PageTitle aside={<StatusBadge status={purchase.status} />}>
            {purchase.purchaseNumber}
          </PageTitle>
          <SummaryCard purchase={purchase} />
          <ActionsCard purchase={purchase} onChange={reload} />
          {purchase.status === "DRAFT" && can("PURCHASE_CREATE") && can("PURCHASE_VIEW") ? (
            <EditCard purchase={purchase} onChange={reload} />
          ) : null}
          <LinesCard purchase={purchase} />
          <ReceiveCard purchase={purchase} onChange={reload} />
          <ReceiptsCard purchase={purchase} />
          <InvoicesCard purchase={purchase} onChange={reload} />
          <PurchaseReturnsCard purchase={purchase} />
        </>
      )}
    </Loaded>
  );
}

function SummaryCard({ purchase }: { purchase: PurchaseView }) {
  const { c, p } = usePurchasingT();
  const rows: [string, string][] = [
    [p.supplier, purchase.supplier.name],
    [p.total, formatPiastres(purchase.orderedTotal) ?? "—"],
    [p.createdBy, `${purchase.createdBy.displayName} · ${formatDate(purchase.createdAt)}`],
  ];
  if (purchase.approvedBy && purchase.approvedAt) {
    rows.push([
      p.approvedBy,
      `${purchase.approvedBy.displayName} · ${formatDate(purchase.approvedAt)}`,
    ]);
  }
  return (
    <Card>
      <dl className="grid gap-3 text-sm sm:grid-cols-3">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt className="text-ink-soft">{label}</dt>
            <dd className="font-semibold">{value}</dd>
          </div>
        ))}
      </dl>
      {purchase.notes ? <p className="mt-3 text-sm whitespace-pre-line">{purchase.notes}</p> : null}
      {purchase.approval &&
      purchase.approval.status !== "APPROVED" &&
      purchase.status === "DRAFT" ? (
        <Notice tone="info">
          {fill(p.rejected, {
            status: c.statuses[purchase.approval.status] ?? purchase.approval.status,
            reason: purchase.approval.resolutionReason ?? "",
          })}
        </Notice>
      ) : null}
      {purchase.cancellationReason ? (
        <Notice tone="info">{fill(p.cancelled, { reason: purchase.cancellationReason })}</Notice>
      ) : null}
      {purchase.closingReason ? (
        <Notice tone="info">{fill(p.closedReason, { reason: purchase.closingReason })}</Notice>
      ) : null}
    </Card>
  );
}

type Action = "submit" | "approve" | "reject" | "send" | "cancel" | "close";

/**
 * Actions offered per status, as listed in API "TASK-022/023 Amendments";
 * `true` marks a required reason. The API decides.
 */
const ACTIONS: Record<string, { action: Action; permission: PermissionCode; reason?: true }[]> = {
  DRAFT: [
    { action: "submit", permission: "PURCHASE_CREATE" },
    { action: "cancel", permission: "PURCHASE_CREATE", reason: true },
  ],
  PENDING_APPROVAL: [
    { action: "approve", permission: "PURCHASE_APPROVE" },
    { action: "reject", permission: "PURCHASE_APPROVE", reason: true },
    { action: "cancel", permission: "PURCHASE_CREATE", reason: true },
  ],
  APPROVED: [
    { action: "send", permission: "PURCHASE_CREATE" },
    { action: "cancel", permission: "PURCHASE_CREATE", reason: true },
  ],
  SENT: [{ action: "cancel", permission: "PURCHASE_CREATE", reason: true }],
  PARTIALLY_RECEIVED: [{ action: "close", permission: "PURCHASE_CREATE", reason: true }],
  RECEIVED: [{ action: "close", permission: "PURCHASE_CREATE", reason: true }],
};

function ActionsCard({ purchase, onChange }: { purchase: PurchaseView; onChange: () => void }) {
  const { c, p } = usePurchasingT();
  const can = useCan();
  const { run, pending, notice, fail } = useAction(onChange);
  const [reason, setReason] = useState("");
  const labels: Record<Action, string> = {
    submit: p.submit,
    approve: p.approve,
    reject: p.reject,
    send: p.send,
    cancel: p.cancelOrder,
    close: p.close,
  };
  const actions = (ACTIONS[purchase.status] ?? []).filter((a) => can(a.permission));
  if (actions.length === 0) {
    return null;
  }
  return (
    <Card title={p.actions}>
      {notice}
      {purchase.status === "APPROVED" ? (
        <p className="mb-3 text-sm text-ink-soft">{p.sendHint}</p>
      ) : null}
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-56 flex-1">
          <Input
            label={c.reasonOptional}
            value={reason}
            maxLength={1000}
            onChange={(event) => setReason(event.target.value)}
          />
        </div>
        {actions.map((a) => (
          <Button
            key={a.action}
            variant={a.action === "cancel" || a.action === "reject" ? "danger" : "primary"}
            disabled={pending}
            onClick={async () => {
              const text = reason.trim();
              if (a.reason && !text) {
                fail(c.reasonRequired);
                return;
              }
              const ok = await run(() =>
                staffPost(
                  `/api/v1/admin/purchases/${purchase.id}/${a.action}`,
                  a.action === "send" ? undefined : { reason: text || undefined },
                ),
              );
              if (ok) setReason("");
            }}
          >
            {labels[a.action]}
          </Button>
        ))}
      </div>
    </Card>
  );
}

function EditCard({ purchase, onChange }: { purchase: PurchaseView; onChange: () => void }) {
  const dictionary = usePurchasingT();
  const { c, p } = dictionary;
  const { run, pending, notice, fail } = useAction(onChange);
  return (
    <Card title={c.edit}>
      {notice}
      <form
        className="grid gap-4"
        onSubmit={submit(async (form) => {
          const items = await purchaseItems(String(form.get("lines") ?? ""), dictionary);
          if (typeof items === "string") {
            fail(items);
            return;
          }
          void run(() =>
            staffApi(`/api/v1/admin/purchases/${purchase.id}`, {
              method: "PATCH",
              body: JSON.stringify({ items, notes: field(form, "notes") ?? null }),
            }),
          );
        })}
      >
        <TextArea
          label={p.linesLabel}
          name="lines"
          rows={Math.max(4, purchase.items.length + 1)}
          required
          dir="ltr"
          defaultValue={formatPurchaseLines(purchase.items)}
        />
        <TextArea
          label={p.notes}
          name="notes"
          maxLength={2000}
          defaultValue={purchase.notes ?? ""}
        />
        <div>
          <Button type="submit" disabled={pending}>
            {c.save}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function LinesCard({ purchase }: { purchase: PurchaseView }) {
  const { p, english } = usePurchasingT();
  return (
    <Card title={p.lines}>
      <Table
        head={[
          p.sku,
          p.item,
          p.ordered,
          p.unitCost,
          p.lineTotal,
          p.received,
          p.accepted,
          p.damagedUnits,
          p.extra,
          p.remaining,
        ]}
      >
        {purchase.items.map((item) => (
          <tr key={item.id}>
            <td className="px-3 py-2" dir="ltr">
              {item.sku}
            </td>
            <td className="px-3 py-2">
              {english ? item.productNameEn : item.productNameAr}
              {item.variantNameAr || item.variantNameEn ? (
                <span className="block text-xs text-ink-soft">
                  {(english ? item.variantNameEn : item.variantNameAr) ??
                    item.variantNameEn ??
                    item.variantNameAr}
                </span>
              ) : null}
            </td>
            <td className="px-3 py-2">{item.orderedQuantity}</td>
            <td className="px-3 py-2">{formatPiastres(item.unitCost) ?? "—"}</td>
            <td className="px-3 py-2">{formatPiastres(item.lineTotal) ?? "—"}</td>
            <td className="px-3 py-2">{item.receivedQuantity}</td>
            <td className="px-3 py-2">{item.acceptedQuantity}</td>
            <td className="px-3 py-2">{item.damagedQuantity}</td>
            <td className="px-3 py-2">{item.extraAcceptedQuantity}</td>
            <td className="px-3 py-2 font-semibold">{item.remainingQuantity}</td>
          </tr>
        ))}
      </Table>
    </Card>
  );
}
