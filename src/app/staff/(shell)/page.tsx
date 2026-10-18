"use client";

import Link from "next/link";
import type { PermissionCode } from "@/server/modules/rbac/catalog";
import { Loaded, useApiData } from "../_components/catalog-ui";
import { countPath } from "../_lib/analytics";
import { useAnalyticsT } from "../_lib/analytics-i18n";
import { useT } from "../_lib/i18n";
import { visibleNav } from "../_lib/navigation";
import { useStaffSession } from "../_lib/session";
import { useLoadPage } from "./_admin/kit";
import { type Overview, Tiles, useMoney } from "./analytics/report";

/**
 * Work queues on the home page (TASK-052A): existing list endpoints read
 * with `pageSize=1`, each shown only with the permission it needs.
 */
const QUEUES: { key: string; permission: PermissionCode; api: string; href: string }[] = [
  {
    key: "codPending",
    permission: "ORDERS_VIEW",
    api: "/api/v1/admin/orders?status=PENDING_CONFIRMATION",
    href: "/staff/orders",
  },
  {
    key: "newOrders",
    permission: "ORDERS_VIEW",
    api: "/api/v1/admin/orders?status=NEW",
    href: "/staff/orders",
  },
  {
    key: "returns",
    permission: "RETURNS_VIEW",
    api: "/api/v1/admin/returns?status=PENDING_APPROVAL",
    href: "/staff/returns",
  },
  {
    key: "contactTasks",
    permission: "CONTACT_TASK_MANAGE",
    api: "/api/v1/admin/contact-tasks?status=OPEN",
    href: "/staff/shipping",
  },
  {
    key: "lowStock",
    permission: "INVENTORY_VIEW",
    api: "/api/v1/admin/inventory/low-stock",
    href: "/staff/inventory",
  },
  {
    key: "approvals",
    permission: "APPROVAL_RESOLVE",
    api: "/api/v1/admin/approval-requests?status=PENDING",
    href: "/staff/approvals",
  },
  {
    key: "invitations",
    permission: "EMPLOYEE_VIEW",
    api: "/api/v1/admin/employees/invitations?status=PENDING",
    href: "/staff/employees/invitations",
  },
];

/** Dashboard home: today's figures, waiting work and the sections this employee may open. */
export default function OverviewPage() {
  const t = useT();
  const { x } = useAnalyticsT();
  const { session } = useStaffSession();
  const sections = visibleNav(session.permissions).flatMap((group) => group.sections);
  const queues = QUEUES.filter((queue) => session.permissions.includes(queue.permission));

  return (
    <section>
      <h1 className="font-[family-name:var(--font-display)] text-3xl text-ink">
        {t.welcome.replace("{name}", session.employee.displayName)}
      </h1>
      <p className="mt-2 mb-6 text-ink-soft">
        {sections.length > 0 ? t.overviewIntro : t.noSections}
      </p>
      {session.permissions.includes("ANALYTICS_VIEW") ? <Today /> : null}
      {queues.length > 0 ? (
        <>
          <h2 className="mb-3 font-[family-name:var(--font-display)] text-xl text-ink">
            {x.queues}
          </h2>
          <ul className="mb-8 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {queues.map((queue) => (
              <Queue key={queue.key} name={queue.key} api={queue.api} href={queue.href} />
            ))}
          </ul>
        </>
      ) : null}
      {sections.length > 0 ? (
        <h2 className="mb-3 font-[family-name:var(--font-display)] text-xl text-ink">
          {x.allSections}
        </h2>
      ) : null}
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {sections.map((section) => (
          <li key={section.slug}>
            <Link
              href={`/staff/${section.slug}`}
              className="block rounded-xl border border-line bg-white p-5 text-ink hover:border-plum"
            >
              {t.sections[section.slug] ?? section.slug}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Today() {
  const { x } = useAnalyticsT();
  const money = useMoney();
  const { state, reload } = useApiData<Overview>("/api/v1/admin/analytics/overview?range=TODAY");
  return (
    <div className="mb-8">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="font-[family-name:var(--font-display)] text-xl text-ink">{x.today}</h2>
        <Link
          href="/staff/analytics"
          className="text-sm text-plum underline-offset-4 hover:underline"
        >
          {x.fullAnalytics}
        </Link>
      </div>
      <Loaded load={state} reload={reload}>
        {(data) => (
          <Tiles
            items={[
              [x.revenue, money(data.revenue)],
              [x.orders, data.orders.count],
              [x.averageOrderValue, money(data.averageOrderValue)],
              [x.newCustomers, data.customers.new],
            ]}
          />
        )}
      </Loaded>
    </div>
  );
}

function Queue({ name, api, href }: { name: string; api: string; href: string }) {
  const { x } = useAnalyticsT();
  const count = useLoadPage<unknown>(countPath(api));
  return (
    <li>
      <Link
        href={href}
        className="flex items-center justify-between gap-3 rounded-xl border border-line bg-white p-5 text-ink hover:border-plum"
      >
        <span>{x.queueLabels[name]}</span>
        <span className="text-2xl font-semibold tabular-nums" aria-busy={count.loading}>
          {count.loading ? "…" : count.error ? "—" : count.totalPages}
        </span>
      </Link>
    </li>
  );
}
