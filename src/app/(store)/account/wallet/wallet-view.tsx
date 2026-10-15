"use client";

import Link from "next/link";
import {
  CustomerOnly,
  Loaded,
  Money,
  Page,
  PageTitle,
  Pager,
  useStoreData,
} from "../../_components/shop";
import { formatDate, type Wallet, type WalletTransaction } from "../../_lib/account";
import type { Pagination } from "../../_lib/api";
import { useLang, useT } from "../../_lib/i18n";
import { AccountNav } from "../account-nav";

/** Wallet (API "TASK-028 Amendments"): balances and the ledger, newest first. */
export function WalletView({ page }: { page: number }) {
  const t = useT();
  return (
    <Page>
      <PageTitle>{t.my.wallet}</PageTitle>
      <AccountNav />
      <CustomerOnly>
        <Balance />
        <Transactions page={page} />
      </CustomerOnly>
    </Page>
  );
}

function Balance() {
  const t = useT();
  const { state, reload } = useStoreData<Wallet>("/api/v1/me/wallet");
  return (
    <Loaded load={state} reload={reload}>
      {(wallet) => (
        <section className="mb-6 flex flex-wrap items-end justify-between gap-4 rounded-xl border border-line bg-white p-6">
          <div>
            <p className="text-xs tracking-[0.15em] text-ink-soft uppercase">
              {t.walletPage.available}
            </p>
            <Money
              value={wallet.available}
              className="font-[family-name:var(--font-display)] text-4xl text-plum"
            />
            <p className="mt-2 max-w-md text-sm text-ink-soft">{t.walletPage.intro}</p>
          </div>
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between gap-6">
              <dt className="text-ink-soft">{t.walletPage.balance}</dt>
              <dd>
                <Money value={wallet.balance} />
              </dd>
            </div>
            {wallet.reserved > 0 ? (
              <div className="flex justify-between gap-6">
                <dt className="text-ink-soft">{t.walletPage.reserved}</dt>
                <dd>
                  <Money value={wallet.reserved} />
                </dd>
              </div>
            ) : null}
          </dl>
        </section>
      )}
    </Loaded>
  );
}

function Transactions({ page }: { page: number }) {
  const t = useT();
  const lang = useLang();
  const { state, reload } = useStoreData<{ data: WalletTransaction[]; pagination: Pagination }>(
    `/api/v1/me/wallet/transactions?page=${page}&pageSize=20`,
    true,
  );
  return (
    <section>
      <h2 className="mb-3 font-[family-name:var(--font-display)] text-xl text-plum">
        {t.walletPage.history}
      </h2>
      <Loaded load={state} reload={reload}>
        {({ data: transactions, pagination }) =>
          transactions.length === 0 ? (
            <p className="text-sm text-ink-soft">{t.walletPage.noTransactions}</p>
          ) : (
            <>
              <ul className="divide-y divide-line rounded-xl border border-line bg-white">
                {transactions.map((tx) => (
                  <li key={tx.id} className="flex items-center justify-between gap-3 p-4 text-sm">
                    <div>
                      <p className="text-ink">{t.walletPage.type[tx.type] ?? tx.type}</p>
                      <p className="text-xs text-ink-soft">
                        {formatDate(tx.createdAt, lang, true)}
                        {tx.referenceType === "ORDER" && tx.referenceId ? (
                          <>
                            {" · "}
                            <Link
                              href={`/account/orders/${tx.referenceId}`}
                              className="text-plum hover:underline"
                            >
                              {t.my.viewOrder}
                            </Link>
                          </>
                        ) : null}
                      </p>
                    </div>
                    <span
                      dir="ltr"
                      className={`font-semibold ${tx.signedAmount < 0 ? "text-ink" : "text-plum"}`}
                    >
                      {tx.signedAmount > 0 ? "+" : ""}
                      <Money value={tx.signedAmount} />
                    </span>
                  </li>
                ))}
              </ul>
              <Pager
                page={pagination.page}
                totalPages={pagination.totalPages}
                href={(p) => `/account/wallet?page=${p}`}
              />
            </>
          )
        }
      </Loaded>
    </section>
  );
}
