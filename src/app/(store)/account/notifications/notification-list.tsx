"use client";

import Link from "next/link";
import { StatusPanel } from "@/app/_components/ui";
import {
  Button,
  CustomerOnly,
  Loaded,
  Page,
  PageTitle,
  Pager,
  useRun,
  useStoreData,
} from "../../_components/shop";
import { formatDate, notificationHref, type CustomerNotification } from "../../_lib/account";
import { storePost, type Pagination } from "../../_lib/api";
import { useLang, useT } from "../../_lib/i18n";
import { AccountNav } from "../account-nav";

/** Notification center (API "TASK-045 Amendments"), newest first. */
export function NotificationList({ page }: { page: number }) {
  const t = useT();
  return (
    <Page>
      <PageTitle>{t.my.notifications}</PageTitle>
      <AccountNav />
      <CustomerOnly>
        <Notifications page={page} />
      </CustomerOnly>
    </Page>
  );
}

type Feed = { data: CustomerNotification[]; pagination: Pagination };

function Notifications({ page }: { page: number }) {
  const t = useT();
  const lang = useLang();
  const { state, reload, set } = useStoreData<Feed>(
    `/api/v1/me/notifications?page=${page}&pageSize=20`,
    true,
  );
  const { run, pending, notice } = useRun();
  return (
    <Loaded load={state} reload={reload}>
      {(loaded) => {
        const markRead = (id: string) =>
          void run(async () => {
            const read = await storePost<CustomerNotification>(
              `/api/v1/me/notifications/${id}/read`,
            );
            set({ ...loaded, data: loaded.data.map((n) => (n.id === id ? read : n)) });
          });
        return loaded.data.length === 0 ? (
          <StatusPanel title={t.notificationsPage.empty} />
        ) : (
          <>
            {notice}
            {loaded.data.some((n) => !n.readAt) ? (
              <div className="mb-3 flex justify-end">
                <Button
                  disabled={pending}
                  onClick={() =>
                    void run(async () => {
                      await storePost("/api/v1/me/notifications/read-all");
                      reload();
                    })
                  }
                >
                  {t.notificationsPage.markAllRead}
                </Button>
              </div>
            ) : null}
            <ul className="divide-y divide-line rounded-xl border border-line bg-white">
              {loaded.data.map((n) => {
                const href = notificationHref(n.deepLink);
                return (
                  <li
                    key={n.id}
                    className={`flex flex-wrap items-start justify-between gap-3 p-4 text-sm ${
                      n.readAt ? "" : "bg-velvet-low"
                    }`}
                  >
                    <div className="max-w-2xl">
                      <p className={n.readAt ? "text-ink" : "font-semibold text-ink"}>
                        {n.readAt ? null : (
                          <span className="sr-only">{t.notificationsPage.unread}: </span>
                        )}
                        {n.title}
                      </p>
                      <p className="text-ink-soft">{n.body}</p>
                      <p className="text-xs text-ink-soft">{formatDate(n.createdAt, lang, true)}</p>
                    </div>
                    <div className="flex gap-3">
                      {href ? (
                        <Link
                          href={href}
                          onClick={() => (n.readAt ? undefined : markRead(n.id))}
                          className="text-sm text-plum hover:underline"
                        >
                          {t.notificationsPage.open}
                        </Link>
                      ) : null}
                      {n.readAt ? null : (
                        <Button variant="link" disabled={pending} onClick={() => markRead(n.id)}>
                          {t.notificationsPage.markRead}
                        </Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
            <Pager
              page={loaded.pagination.page}
              totalPages={loaded.pagination.totalPages}
              href={(p) => `/account/notifications?page=${p}`}
            />
          </>
        );
      }}
    </Loaded>
  );
}
