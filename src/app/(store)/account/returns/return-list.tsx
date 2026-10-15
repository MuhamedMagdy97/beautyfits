"use client";

import Link from "next/link";
import { StatusPanel } from "@/app/_components/ui";
import { CustomerOnly, Loaded, Page, PageTitle, Pager, useStoreData } from "../../_components/shop";
import { formatDate, type ReturnRequest } from "../../_lib/account";
import type { Pagination } from "../../_lib/api";
import { useLang, useT } from "../../_lib/i18n";
import { AccountNav } from "../account-nav";
import { StatusBadge } from "../orders/order-list";

/** Return requests (API "TASK-037 Amendments": `GET /me/returns`, newest first). */
export function ReturnList({ page }: { page: number }) {
  const t = useT();
  return (
    <Page>
      <PageTitle>{t.my.returns}</PageTitle>
      <AccountNav />
      <CustomerOnly>
        <Returns page={page} />
      </CustomerOnly>
    </Page>
  );
}

function Returns({ page }: { page: number }) {
  const t = useT();
  const lang = useLang();
  const { state, reload } = useStoreData<{ data: ReturnRequest[]; pagination: Pagination }>(
    `/api/v1/me/returns?page=${page}&pageSize=10`,
    true,
  );
  return (
    <Loaded load={state} reload={reload}>
      {({ data: returns, pagination }) =>
        returns.length === 0 ? (
          <StatusPanel title={t.returnsPage.noReturns} message={t.returnsPage.windowNote} />
        ) : (
          <>
            <ul className="space-y-3">
              {returns.map((item) => (
                <li key={item.id}>
                  <Link
                    href={`/account/returns/${item.id}`}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-white p-4 hover:border-plum"
                  >
                    <div className="space-y-1 text-sm">
                      <p className="font-semibold text-ink" dir="ltr">
                        {item.returnNumber}
                      </p>
                      <p className="text-ink-soft">
                        {t.returnsPage.forOrder.replace("{number}", item.orderNumber)} ·{" "}
                        {t.returnsPage.requested.replace(
                          "{date}",
                          formatDate(item.createdAt, lang),
                        )}
                      </p>
                    </div>
                    <StatusBadge status={t.returnsPage.status[item.status] ?? item.status} />
                  </Link>
                </li>
              ))}
            </ul>
            <Pager
              page={pagination.page}
              totalPages={pagination.totalPages}
              href={(p) => `/account/returns?page=${p}`}
            />
          </>
        )
      }
    </Loaded>
  );
}
