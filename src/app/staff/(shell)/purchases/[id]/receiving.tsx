"use client";

import Link from "next/link";
import { useState } from "react";
import type { ReceiveResult } from "@/server/modules/purchasing/goods-receipts-service";
import type { PurchaseView } from "@/server/modules/purchasing/purchase-orders-service";
import {
  Button,
  Card,
  formatDate,
  Table,
  TextArea,
  useAction,
  useCan,
} from "../../../_components/catalog-ui";
import { Notice } from "../../../_components/ui";
import { staffApi } from "../../../_lib/api";
import { field } from "../../../_lib/forms";
import { countField } from "../../../_lib/purchasing";
import { fill, usePurchasingT } from "../../../_lib/purchasing-i18n";

/** Statuses that can be received (API "TASK-023 Amendments"). */
const RECEIVABLE = ["APPROVED", "SENT", "PARTIALLY_RECEIVED"];

const cell = "w-20 rounded-md border border-line bg-velvet-low px-2 py-1 text-sm";

/**
 * Goods receiving (TASK-023): one delivery, counted line by line. The API
 * splits accepted, damaged and extra units and keeps retries idempotent.
 */
export function ReceiveCard({
  purchase,
  onChange,
}: {
  purchase: PurchaseView;
  onChange: () => void;
}) {
  const { c, p } = usePurchasingT();
  const can = useCan();
  const { run, pending, notice, fail } = useAction(onChange);
  // One key per delivery being typed: a retried submit records one receipt.
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [review, setReview] = useState<string | null>(null);
  if (!can("RECEIVE_PURCHASE") || !RECEIVABLE.includes(purchase.status)) {
    // The last delivery may have completed the order: keep its cost review visible.
    return review ? <Notice tone="info">{review}</Notice> : null;
  }
  return (
    <Card title={p.receive}>
      <p className="mb-3 text-sm text-ink-soft">{p.receiveHint}</p>
      {notice}
      {review ? <p className="mb-3 text-sm text-ink">{review}</p> : null}
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          const element = event.currentTarget;
          const form = new FormData(element);
          const items: {
            purchaseItemId: string;
            deliveredQuantity: number;
            damagedQuantity: number;
            notes?: string;
          }[] = [];
          for (const item of purchase.items) {
            const delivered = countField(String(form.get(`delivered-${item.id}`) ?? ""));
            const damaged = countField(String(form.get(`damaged-${item.id}`) ?? ""));
            if (delivered === null || damaged === null) {
              fail(p.badCount);
              return;
            }
            if (delivered > 0) {
              items.push({
                purchaseItemId: item.id,
                deliveredQuantity: delivered,
                damagedQuantity: damaged,
                notes: field(form, `notes-${item.id}`),
              });
            }
          }
          if (items.length === 0) {
            fail(p.nothingToReceive);
            return;
          }
          let result: ReceiveResult | undefined;
          const ok = await run(async () => {
            result = await staffApi<ReceiveResult>(
              `/api/v1/admin/purchases/${purchase.id}/receive`,
              {
                method: "POST",
                headers: { "idempotency-key": key },
                body: JSON.stringify({ notes: field(form, "notes"), items }),
              },
            );
          }, c.saved);
          if (ok && result) {
            element.reset();
            setKey(crypto.randomUUID());
            const changed = (result.costReview ?? []).filter((item) => item.warnings.length > 0);
            const skus = changed
              .map((item) => purchase.items.find((line) => line.variantId === item.variantId)?.sku)
              .filter(Boolean)
              .join(", ");
            setReview(
              [
                fill(p.receiptRecorded, { number: result.receipt.receiptNumber }),
                skus ? fill(p.costReview, { skus }) : "",
              ].join(" "),
            );
          }
        }}
      >
        <Table head={[p.sku, p.remaining, p.delivered, p.damagedUnits, p.lineNotes]}>
          {purchase.items.map((item) => (
            <tr key={item.id}>
              <td className="px-3 py-2" dir="ltr">
                {item.sku}
              </td>
              <td className="px-3 py-2">{item.remainingQuantity}</td>
              <td className="px-3 py-2">
                <input
                  name={`delivered-${item.id}`}
                  inputMode="numeric"
                  aria-label={`${p.delivered} ${item.sku}`}
                  className={cell}
                />
              </td>
              <td className="px-3 py-2">
                <input
                  name={`damaged-${item.id}`}
                  inputMode="numeric"
                  aria-label={`${p.damagedUnits} ${item.sku}`}
                  className={cell}
                />
              </td>
              <td className="px-3 py-2">
                <input
                  name={`notes-${item.id}`}
                  maxLength={1000}
                  aria-label={`${p.lineNotes} ${item.sku}`}
                  className="w-full min-w-40 rounded-md border border-line bg-velvet-low px-2 py-1 text-sm"
                />
              </td>
            </tr>
          ))}
        </Table>
        <div className="mt-4 grid gap-4">
          <TextArea label={p.deliveryNotes} name="notes" maxLength={2000} />
          <div>
            <Button type="submit" disabled={pending}>
              {p.receive}
            </Button>
          </div>
        </div>
      </form>
    </Card>
  );
}

/** Recorded goods receipts, with the approval state of any extras (Q116). */
export function ReceiptsCard({ purchase }: { purchase: PurchaseView }) {
  const { c, p } = usePurchasingT();
  if (purchase.receipts.length === 0) {
    return null;
  }
  return (
    <Card title={p.receipts}>
      <ul className="grid gap-4">
        {purchase.receipts.map((receipt) => (
          <li key={receipt.id} className="rounded-lg border border-line p-3">
            <p className="mb-2 text-sm">
              <span className="font-semibold" dir="ltr">
                {receipt.receiptNumber}
              </span>{" "}
              · {receipt.receivedBy.displayName} · {formatDate(receipt.receivedAt)}
            </p>
            {receipt.overDelivery ? (
              <p className="mb-2 text-sm">
                {fill(p.overDelivery, {
                  status: c.statuses[receipt.overDelivery.status] ?? receipt.overDelivery.status,
                })}
                {receipt.overDelivery.status === "PENDING" ? (
                  <>
                    {" · "}
                    <Link href="/staff/approvals" className="text-plum hover:underline">
                      {p.approvalQueue}
                    </Link>
                  </>
                ) : null}
              </p>
            ) : null}
            {receipt.notes ? <p className="mb-2 text-sm text-ink-soft">{receipt.notes}</p> : null}
            <Table
              head={[p.sku, p.delivered, p.accepted, p.damagedUnits, p.extra, p.inspectionNotes]}
            >
              {receipt.items.map((item) => (
                <tr key={item.purchaseItemId}>
                  <td className="px-3 py-2" dir="ltr">
                    {item.sku}
                  </td>
                  <td className="px-3 py-2">{item.deliveredQuantity}</td>
                  <td className="px-3 py-2">{item.acceptedQuantity}</td>
                  <td className="px-3 py-2">{item.damagedQuantity}</td>
                  <td className="px-3 py-2">{item.overDeliveryQuantity}</td>
                  <td className="px-3 py-2">{item.inspectionNotes ?? "—"}</td>
                </tr>
              ))}
            </Table>
          </li>
        ))}
      </ul>
    </Card>
  );
}
