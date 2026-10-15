"use client";

import Link from "next/link";
import { StatusPanel, TextLink } from "@/app/_components/ui";
import {
  CustomerOnly,
  Loaded,
  Money,
  Page,
  PageTitle,
  Pager,
  useStoreData,
} from "../../_components/shop";
import { formatDate, type OrderListItem } from "../../_lib/account";
import type { Pagination } from "../../_lib/api";
import { useLang, useT } from "../../_lib/i18n";
import { AccountNav } from "../account-nav";

/** Order history (API "TASK-030 Amendments": `GET /me/orders`, newest first). */
export function OrderList({ page }: { page: number }) {
  const t = useT();
  return (
    <Page>
      <PageTitle>{t.my.orders}</PageTitle>
      <AccountNav />
      <CustomerOnly>
        <Orders page={page} />
      </CustomerOnly>
    </Page>
  );
}

function Orders({ page }: { page: number }) {
  const t = useT();
  const lang = useLang();
  const { state, reload } = useStoreData<{ data: OrderListItem[]; pagination: Pagination }>(
    `/api/v1/me/orders?page=${page}&pageSize=10`,
    true,
  );
  return (
    <Loaded load={state} reload={reload}>
      {({ data: orders, pagination }) =>
        orders.length === 0 ? (
          <StatusPanel
            title={t.my.noOrders}
            action={<TextLink href="/products">{t.cartPage.continueShopping}</TextLink>}
          />
        ) : (
          <>
            <ul className="space-y-3">
              {orders.map((order) => (
                <li key={order.id}>
                  <Link
                    href={`/account/orders/${order.id}`}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-white p-4 hover:border-plum"
                  >
                    <div className="space-y-1 text-sm">
                      <p className="font-semibold text-ink" dir="ltr">
                        {order.orderNumber}
                      </p>
                      <p className="text-ink-soft">
                        {t.my.placedOn.replace("{date}", formatDate(order.createdAt, lang))} ·{" "}
                        {t.my.items.replace("{n}", String(order.itemCount))}
                      </p>
                    </div>
                    <div className="flex items-center gap-4">
                      <StatusBadge status={t.my.status[order.status] ?? order.status} />
                      <Money value={order.total} className="font-semibold text-ink" />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
            <Pager
              page={pagination.page}
              totalPages={pagination.totalPages}
              href={(p) => `/account/orders?page=${p}`}
            />
          </>
        )
      }
    </Loaded>
  );
}

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className="rounded-full bg-velvet-low px-3 py-1 text-xs font-semibold tracking-wide text-plum uppercase">
      {status}
    </span>
  );
}
