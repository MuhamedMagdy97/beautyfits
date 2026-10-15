"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import type {
  LedgerEntryView,
  SupplierBalanceView,
} from "@/server/modules/purchasing/supplier-ledger";
import {
  Button,
  Card,
  formatDate,
  Guard,
  Input,
  Loaded,
  PageTitle,
  Pager,
  Select,
  Table,
  TextArea,
  useAction,
  useApiData,
  useCan,
} from "../../../_components/catalog-ui";
import { staffApi } from "../../../_lib/api";
import { field } from "../../../_lib/forms";
import { formatPiastres, parsePounds } from "../../../_lib/money";
import { usePurchasingT } from "../../../_lib/purchasing-i18n";

const PAGE_SIZE = 50;

/** A supplier's balance, ledger and payments (TASK-024, API "TASK-024 Amendments"). */
export default function SupplierFinancePage() {
  return (
    <Guard anyOf={["SUPPLIER_FINANCE_VIEW"]}>
      <Suspense>
        <SupplierFinance />
      </Suspense>
    </Guard>
  );
}

function SupplierFinance() {
  const { p } = usePurchasingT();
  const can = useCan();
  const { id } = useParams<{ id: string }>();
  // Display only: there is no single-supplier read endpoint (see the TASK-055 open items).
  const name = useSearchParams().get("name");
  const balance = useApiData<SupplierBalanceView>(`/api/v1/admin/suppliers/${id}/balance`);
  // Bumped after a payment so the ledger loads again.
  const [round, setRound] = useState(0);

  return (
    <>
      <Link href="/staff/suppliers" className="text-sm text-plum hover:underline">
        ← {p.suppliers}
      </Link>
      <PageTitle>{name ? `${name} — ${p.finance}` : p.finance}</PageTitle>
      <Loaded load={balance.state} reload={balance.reload}>
        {(data) => (
          <>
            <BalanceCard balance={data} />
            {can("SUPPLIER_PAYMENT_MANAGE") ? (
              <PaymentCard
                supplierId={id}
                balance={data}
                onChange={() => {
                  balance.reload();
                  setRound((n) => n + 1);
                }}
              />
            ) : null}
          </>
        )}
      </Loaded>
      <LedgerCard key={round} supplierId={id} />
    </>
  );
}

function BalanceCard({ balance }: { balance: SupplierBalanceView }) {
  const { c, p } = usePurchasingT();
  const totals: [string, number][] = [
    [p.invoiced, balance.totals.invoiced],
    [p.paid, balance.totals.paid],
    [p.credited, balance.totals.credited],
    [p.refunded, balance.totals.refunded],
  ];
  return (
    <Card>
      <p className="text-sm text-ink-soft">{p.balance}</p>
      <p className="font-[family-name:var(--font-display)] text-3xl text-ink" dir="ltr">
        {formatPiastres(balance.balance)} {balance.currency}
      </p>
      <p className="mb-4 text-xs text-ink-soft">{p.balanceHint}</p>
      <dl className="mb-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        {totals.map(([label, value]) => (
          <div key={label}>
            <dt className="text-ink-soft">{label}</dt>
            <dd className="font-semibold" dir="ltr">
              {formatPiastres(value)}
            </dd>
          </div>
        ))}
      </dl>
      {balance.purchases.length > 0 ? (
        <Table head={[p.purchase, p.invoiced, p.paid, p.balance, p.paymentStatus]}>
          {balance.purchases.map((purchase) => (
            <tr key={purchase.id}>
              <td className="px-3 py-2" dir="ltr">
                <Link
                  href={`/staff/purchases/${purchase.id}`}
                  className="font-semibold text-plum hover:underline"
                >
                  {purchase.purchaseNumber}
                </Link>
              </td>
              <td className="px-3 py-2">{formatPiastres(purchase.invoiced)}</td>
              <td className="px-3 py-2">{formatPiastres(purchase.paid)}</td>
              <td className="px-3 py-2">{formatPiastres(purchase.balance)}</td>
              <td className="px-3 py-2">
                {p.paymentStatuses[purchase.paymentStatus] ?? purchase.paymentStatus}
              </td>
            </tr>
          ))}
        </Table>
      ) : (
        <p className="text-sm text-ink-soft">{c.empty}</p>
      )}
    </Card>
  );
}

function PaymentCard({
  supplierId,
  balance,
  onChange,
}: {
  supplierId: string;
  balance: SupplierBalanceView;
  onChange: () => void;
}) {
  const { c, p } = usePurchasingT();
  const { run, pending, notice, fail } = useAction(onChange);
  // One key per payment being typed: a retry of the same request is not recorded twice.
  const [key, setKey] = useState(() => crypto.randomUUID());
  return (
    <Card title={p.recordPayment}>
      {notice}
      <form
        className="grid gap-4 sm:grid-cols-3"
        onSubmit={async (event) => {
          event.preventDefault();
          const element = event.currentTarget;
          const form = new FormData(element);
          const amount = parsePounds(String(form.get("amount") ?? ""));
          if (amount === null || amount < 1) {
            fail(c.invalidAmount);
            return;
          }
          const ok = await run(() =>
            staffApi(`/api/v1/admin/suppliers/${supplierId}/payments`, {
              method: "POST",
              headers: { "idempotency-key": key },
              body: JSON.stringify({
                amount,
                method: field(form, "method"),
                paidOn: field(form, "paidOn"),
                purchaseId: field(form, "purchaseId"),
                reference: field(form, "reference"),
                notes: field(form, "notes"),
              }),
            }),
          );
          if (ok) {
            element.reset();
            setKey(crypto.randomUUID());
          }
        }}
      >
        <Input label={p.amount} name="amount" inputMode="decimal" required dir="ltr" />
        <Select label={p.method} name="method" defaultValue="BANK_TRANSFER">
          {Object.entries(p.methods).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
        <Input label={p.paidOn} name="paidOn" type="date" required />
        <Select label={p.purchaseOptional} name="purchaseId" defaultValue="">
          <option value="">—</option>
          {balance.purchases.map((purchase) => (
            <option key={purchase.id} value={purchase.id}>
              {purchase.purchaseNumber}
            </option>
          ))}
        </Select>
        <Input label={p.reference} name="reference" maxLength={200} />
        <div className="sm:col-span-3">
          <TextArea label={p.notes} name="notes" maxLength={2000} />
        </div>
        <div>
          <Button type="submit" disabled={pending}>
            {p.recordPayment}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function LedgerCard({ supplierId }: { supplierId: string }) {
  const { c, p } = usePurchasingT();
  const [page, setPage] = useState(1);
  const { state, reload } = useApiData<LedgerEntryView[]>(
    `/api/v1/admin/suppliers/${supplierId}/ledger?page=${page}&pageSize=${PAGE_SIZE}`,
  );
  return (
    <Card title={p.ledger}>
      <Loaded load={state} reload={reload}>
        {(entries) => (
          <>
            <Table head={[c.date, p.entryType, p.amount, p.purchase, p.reference, c.by]}>
              {entries.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-ink-soft">
                    {c.empty}
                  </td>
                </tr>
              ) : null}
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td className="px-3 py-2">{formatDate(entry.createdAt)}</td>
                  <td className="px-3 py-2">
                    {p.entryTypes[entry.entryType] ?? entry.entryType}
                    {entry.supplierReturn ? ` · ${entry.supplierReturn.returnNumber}` : ""}
                  </td>
                  <td className="px-3 py-2 font-semibold" dir="ltr">
                    {entry.signedAmount > 0 ? "+" : ""}
                    {formatPiastres(entry.signedAmount)}
                  </td>
                  <td className="px-3 py-2" dir="ltr">
                    {entry.purchase?.purchaseNumber ?? "—"}
                  </td>
                  <td className="px-3 py-2">{entry.reference ?? "—"}</td>
                  <td className="px-3 py-2">{entry.createdBy.displayName}</td>
                </tr>
              ))}
            </Table>
            <Pager page={page} count={entries.length} pageSize={PAGE_SIZE} onPage={setPage} />
          </>
        )}
      </Loaded>
    </Card>
  );
}
