"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import type { SupplierReturnView } from "@/server/modules/purchasing/supplier-returns-service";
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
  TextArea,
  useAction,
  useApiData,
  useCan,
} from "../../../../_components/catalog-ui";
import { Notice } from "../../../../_components/ui";
import { staffPost } from "../../../../_lib/api";
import { field } from "../../../../_lib/forms";
import { formatPiastres, parsePounds } from "../../../../_lib/money";
import { usePurchasingT } from "../../../../_lib/purchasing-i18n";
import { RETURN_READERS } from "../../tabs";

/** One supplier return: lines, submit for approval, settlement (TASK-024, Q105–Q107, Q120). */
export default function SupplierReturnPage() {
  return (
    <Guard anyOf={RETURN_READERS}>
      <SupplierReturn />
    </Guard>
  );
}

function SupplierReturn() {
  const { p } = usePurchasingT();
  const can = useCan();
  const { id } = useParams<{ id: string }>();
  const { state, reload } = useApiData<SupplierReturnView>(`/api/v1/admin/supplier-returns/${id}`);

  return (
    <Loaded load={state} reload={reload}>
      {(item) => (
        <>
          <Link href="/staff/purchases/returns" className="text-sm text-plum hover:underline">
            ← {p.supplierReturns}
          </Link>
          <PageTitle aside={<StatusBadge status={item.status} />}>{item.returnNumber}</PageTitle>
          <Card>
            <dl className="grid gap-3 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-ink-soft">{p.supplier}</dt>
                <dd className="font-semibold">{item.supplier.name}</dd>
              </div>
              <div>
                <dt className="text-ink-soft">{p.purchase}</dt>
                <dd className="font-semibold" dir="ltr">
                  <Link
                    href={`/staff/purchases/${item.purchase.id}`}
                    className="text-plum hover:underline"
                  >
                    {item.purchase.purchaseNumber}
                  </Link>
                </dd>
              </div>
              <div>
                <dt className="text-ink-soft">{p.expected}</dt>
                <dd className="font-semibold">{formatPiastres(item.expectedAmount)}</dd>
              </div>
              <div>
                <dt className="text-ink-soft">{p.createdBy}</dt>
                <dd>
                  {item.createdBy.displayName} · {formatDate(item.createdAt)}
                </dd>
              </div>
              {item.approvedBy && item.approvedAt ? (
                <div>
                  <dt className="text-ink-soft">{p.approvedBy}</dt>
                  <dd>
                    {item.approvedBy.displayName} · {formatDate(item.approvedAt)}
                  </dd>
                </div>
              ) : null}
            </dl>
            <p className="mt-3 text-sm">
              <span className="text-ink-soft">{p.reason}: </span>
              {item.reason}
            </p>
            {item.approval?.resolutionReason ? (
              <Notice tone="info">{item.approval.resolutionReason}</Notice>
            ) : null}
            {item.status === "PENDING_APPROVAL" ? (
              <Link
                href="/staff/approvals"
                className="mt-3 inline-block text-sm text-plum hover:underline"
              >
                {p.approvalQueue}
              </Link>
            ) : null}
          </Card>
          <Card title={p.lines}>
            <Table head={[p.sku, p.receipts, p.quantity, p.unitCost, p.lineTotal, p.reason]}>
              {item.items.map((line) => (
                <tr key={line.id}>
                  <td className="px-3 py-2" dir="ltr">
                    {line.sku}
                  </td>
                  <td className="px-3 py-2" dir="ltr">
                    {line.receiptNumber}
                  </td>
                  <td className="px-3 py-2">{line.quantity}</td>
                  <td className="px-3 py-2">{formatPiastres(line.unitCost)}</td>
                  <td className="px-3 py-2">{formatPiastres(line.lineTotal)}</td>
                  <td className="px-3 py-2">{line.reason ?? "—"}</td>
                </tr>
              ))}
            </Table>
          </Card>
          {item.status === "SETTLED" ? (
            <Card title={p.settlement}>
              <p className="text-sm">
                {p.resolutions[item.financialResolution ?? ""] ?? item.financialResolution} ·{" "}
                {formatPiastres(item.financialAmount)}
                {item.settledBy ? ` · ${item.settledBy.displayName}` : ""}
                {item.settledAt ? ` · ${formatDate(item.settledAt)}` : ""}
              </p>
              {item.settlementNotes ? (
                <p className="mt-2 text-sm text-ink-soft">{item.settlementNotes}</p>
              ) : null}
            </Card>
          ) : null}
          {item.status === "DRAFT" && can("SUPPLIER_RETURN_MANAGE") ? (
            <SubmitCard id={item.id} onChange={reload} />
          ) : null}
          {item.status === "APPROVED" && can("SUPPLIER_PAYMENT_MANAGE") ? (
            <SettleCard id={item.id} onChange={reload} />
          ) : null}
        </>
      )}
    </Loaded>
  );
}

function SubmitCard({ id, onChange }: { id: string; onChange: () => void }) {
  const { c, p } = usePurchasingT();
  const { run, pending, notice } = useAction(onChange);
  const [reason, setReason] = useState("");
  return (
    <Card title={p.submitReturn}>
      {notice}
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-56 flex-1">
          <Input
            label={c.reasonOptional}
            value={reason}
            maxLength={1000}
            onChange={(event) => setReason(event.target.value)}
          />
        </div>
        <Button
          disabled={pending}
          onClick={() =>
            void run(() =>
              staffPost(`/api/v1/admin/supplier-returns/${id}/submit`, {
                reason: reason.trim() || undefined,
              }),
            )
          }
        >
          {p.submitReturn}
        </Button>
      </div>
    </Card>
  );
}

function SettleCard({ id, onChange }: { id: string; onChange: () => void }) {
  const { c, p } = usePurchasingT();
  const { run, pending, notice, fail } = useAction(onChange);
  return (
    <Card title={p.settle}>
      {notice}
      <form
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          const amountText = String(form.get("amount") ?? "").trim();
          const amount = amountText === "" ? undefined : parsePounds(amountText);
          if (amount === null) {
            fail(c.invalidAmount);
            return;
          }
          void run(() =>
            staffPost(`/api/v1/admin/supplier-returns/${id}/settle`, {
              resolution: field(form, "resolution"),
              amount,
              notes: field(form, "notes"),
            }),
          );
        }}
      >
        <Select label={p.resolution} name="resolution" defaultValue="CREDIT">
          {Object.entries(p.resolutions).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
        <Input label={p.settleAmount} name="amount" inputMode="decimal" dir="ltr" />
        <div className="sm:col-span-2">
          <TextArea label={p.settleNotes} name="notes" maxLength={2000} />
        </div>
        <div>
          <Button type="submit" disabled={pending}>
            {p.settle}
          </Button>
        </div>
      </form>
    </Card>
  );
}
