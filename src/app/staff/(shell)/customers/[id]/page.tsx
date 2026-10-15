"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import type { AdminCustomerView } from "@/server/modules/customers/admin-customers-service";
import type { WalletTransactionView, WalletView } from "@/server/modules/wallet/wallet-service";
import {
  Card,
  formatDate,
  Guard,
  Loaded,
  PageTitle,
  StatusBadge,
  Table,
  useApiData,
  useCan,
} from "../../../_components/catalog-ui";
import { formatPiastres } from "../../../_lib/money";
import { accountLabel, useOrdersT } from "../../../_lib/orders-i18n";

/**
 * One customer (TASK-054): profile, contact data and addresses (with
 * `VIEW_CUSTOMER_CONTACT`), latest orders and the wallet (with
 * `VIEW_WALLET_BALANCE`). Wallet adjustments live on the wallet screen.
 */
export default function CustomerPage() {
  return (
    <Guard anyOf={["CUSTOMER_VIEW"]}>
      <Customer />
    </Guard>
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

function Customer() {
  const { id } = useParams<{ id: string }>();
  const { o } = useOrdersT();
  const can = useCan();
  const { state, reload } = useApiData<AdminCustomerView>(`/api/v1/admin/customers/${id}`);
  return (
    <Loaded load={state} reload={reload}>
      {(customer) => (
        <>
          <Link href="/staff/customers" className="text-sm text-plum hover:underline">
            ← {o.customers}
          </Link>
          <PageTitle>{customer.fullName}</PageTitle>
          <Profile customer={customer} />
          {customer.addresses ? <Addresses customer={customer} /> : null}
          <Orders customer={customer} />
          {can("VIEW_WALLET_BALANCE") ? <Wallet customerId={customer.id} /> : null}
        </>
      )}
    </Loaded>
  );
}

function Profile({ customer }: { customer: AdminCustomerView }) {
  const { o } = useOrdersT();
  return (
    <Card>
      <dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
        <Row label={o.accountStatus}>{accountLabel(o, customer)}</Row>
        <Row label={o.since}>{formatDate(customer.createdAt)}</Row>
        <Row label={o.language}>
          {o.languages[customer.preferredLocale] ?? customer.preferredLocale}
        </Row>
        {customer.phone !== undefined ? (
          <>
            <Row label={o.phone}>
              <span dir="ltr">{customer.phone}</span>
              <span className="block text-xs font-normal text-ink-soft">
                {customer.phoneVerified ? o.verified : o.notVerified}
              </span>
            </Row>
            <Row label={o.email}>
              <span dir="ltr">{customer.email ?? "—"}</span>
              <span className="block text-xs font-normal text-ink-soft">
                {customer.emailVerified ? o.verified : o.notVerified}
              </span>
            </Row>
          </>
        ) : (
          <p className="text-xs text-ink-soft sm:col-span-2">{o.contactHidden}</p>
        )}
      </dl>
    </Card>
  );
}

function Addresses({ customer }: { customer: AdminCustomerView }) {
  const { c, o } = useOrdersT();
  const addresses = customer.addresses ?? [];
  return (
    <Card title={o.addresses}>
      {addresses.length === 0 ? <p className="text-sm text-ink-soft">{c.empty}</p> : null}
      <ul className="grid gap-3 sm:grid-cols-2">
        {addresses.map((address) => (
          <li key={address.id} className="rounded-lg border border-line p-3 text-sm">
            <p className="font-semibold">
              {address.label ?? address.recipientName}
              {address.isDefault ? (
                <span className="ms-2 text-xs font-normal text-plum">{o.defaultAddress}</span>
              ) : null}
            </p>
            <p>
              {address.governorate.name} / {address.area.name}
            </p>
            <p>
              {[address.street, address.building, address.floor, address.apartment, address.city]
                .filter(Boolean)
                .join(c.listSeparator)}
            </p>
            {address.landmark ? <p className="text-ink-soft">{address.landmark}</p> : null}
            <p>
              {address.recipientName} · <span dir="ltr">{address.phone}</span>
            </p>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Orders({ customer }: { customer: AdminCustomerView }) {
  const { c, o } = useOrdersT();
  const can = useCan();
  const orders = can("ORDERS_VIEW");
  return (
    <Card title={`${o.latestOrders} (${customer.orderCount})`}>
      <Table head={[o.order, c.status, o.items, o.total, o.createdAt]}>
        {customer.orders.length === 0 ? (
          <tr>
            <td colSpan={5} className="px-3 py-6 text-center text-ink-soft">
              {c.empty}
            </td>
          </tr>
        ) : null}
        {customer.orders.map((order) => (
          <tr key={order.id}>
            <td className="px-3 py-2" dir="ltr">
              {orders ? (
                <Link
                  href={`/staff/orders/${order.id}`}
                  className="font-semibold text-plum hover:underline"
                >
                  {order.orderNumber}
                </Link>
              ) : (
                order.orderNumber
              )}
            </td>
            <td className="px-3 py-2">
              <StatusBadge status={order.status} />
            </td>
            <td className="px-3 py-2">{order.itemCount}</td>
            <td className="px-3 py-2">{formatPiastres(order.total)}</td>
            <td className="px-3 py-2">{formatDate(order.createdAt)}</td>
          </tr>
        ))}
      </Table>
      <div className="mt-3 flex flex-wrap gap-4 text-sm">
        {orders && customer.orderCount > customer.orders.length ? (
          <Link
            href={`/staff/orders?customerId=${customer.id}`}
            className="text-plum hover:underline"
          >
            {o.allOrders} →
          </Link>
        ) : null}
        {can("RETURNS_VIEW") ? (
          <Link
            href={`/staff/returns?customerId=${customer.id}`}
            className="text-plum hover:underline"
          >
            {o.returns} →
          </Link>
        ) : null}
      </div>
    </Card>
  );
}

function Wallet({ customerId }: { customerId: string }) {
  const { c, o } = useOrdersT();
  const can = useCan();
  const base = `/api/v1/admin/customers/${customerId}/wallet`;
  const wallet = useApiData<WalletView>(base);
  const transactions = useApiData<WalletTransactionView[]>(`${base}/transactions?pageSize=20`);
  return (
    <Card title={o.wallet}>
      <Loaded load={wallet.state} reload={wallet.reload}>
        {(view) => (
          <dl className="mb-4 grid gap-3 text-sm sm:grid-cols-3">
            <Row label={o.walletBalance}>{formatPiastres(view.balance)}</Row>
            <Row label={o.walletReservedNow}>{formatPiastres(view.reserved)}</Row>
            <Row label={o.walletAvailable}>{formatPiastres(view.available)}</Row>
          </dl>
        )}
      </Loaded>
      <h3 className="mb-2 text-sm font-semibold text-ink">{o.transactions}</h3>
      <Loaded load={transactions.state} reload={transactions.reload}>
        {(rows) => (
          <Table head={[o.type, o.amount, o.reason, o.at]}>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-ink-soft">
                  {c.empty}
                </td>
              </tr>
            ) : null}
            {rows.map((row) => (
              <tr key={row.id}>
                <td className="px-3 py-2">{o.walletTypes[row.type] ?? row.type}</td>
                <td className="px-3 py-2" dir="ltr">
                  {row.signedAmount > 0 ? "+" : ""}
                  {formatPiastres(row.signedAmount)}
                </td>
                <td className="px-3 py-2">{row.reason ?? "—"}</td>
                <td className="px-3 py-2">{formatDate(row.createdAt)}</td>
              </tr>
            ))}
          </Table>
        )}
      </Loaded>
      {can("ADJUST_WALLET") ? (
        <Link
          href={`/staff/wallet?customerId=${customerId}`}
          className="mt-3 inline-block text-sm text-plum hover:underline"
        >
          {o.adjustWallet} →
        </Link>
      ) : null}
    </Card>
  );
}
