"use client";

import { useState } from "react";
import { submit } from "../../_components/ui";
import {
  Button,
  Card,
  Guard,
  inputClass,
  Json,
  LoadState,
  PageHeader,
  Pager,
  useAdminT,
  useLoadPage,
} from "../_admin/kit";

/** `auditLog` (API "TASK-013 Amendments"). */
interface AuditLog {
  id: string;
  actor: { type: string; id: string | null; displayName: string | null };
  action: string;
  entityType: string;
  entityId: string;
  previousData: unknown;
  newData: unknown;
  reason: string | null;
  correlationId: string | null;
  createdAt: string;
}

const FILTERS = ["action", "entityType", "entityId"] as const;

/** Audit log viewer (TASK-057, Q70, Q79; `VIEW_AUDIT_LOGS`, Owner/Admin). Read-only. */
export default function AuditLogsPage() {
  const { t } = useAdminT();
  return (
    <Guard permission="VIEW_AUDIT_LOGS" title={t.sections["audit-logs"]}>
      <AuditLogs />
    </Guard>
  );
}

function AuditLogs() {
  const { t, a } = useAdminT();
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [page, setPage] = useState(1);
  const query = new URLSearchParams({ page: String(page), pageSize: "25", ...filters });
  const list = useLoadPage<AuditLog>(`/api/v1/admin/audit-logs?${query}`);

  const apply = submit((form) => {
    const next: Record<string, string> = {};
    for (const name of FILTERS) {
      const value = String(form.get(name) ?? "").trim();
      if (value) {
        next[name] = value;
      }
    }
    // Picked days are local and inclusive; the API takes instants and `to` is exclusive.
    for (const name of ["from", "to"] as const) {
      const value = String(form.get(name) ?? "");
      if (value) {
        const day = new Date(`${value}T00:00:00`);
        if (name === "to") {
          day.setDate(day.getDate() + 1);
        }
        next[name] = day.toISOString();
      }
    }
    setFilters(next);
    setPage(1);
  });

  const labels: Record<string, string> = {
    action: a.action,
    entityType: a.entity,
    entityId: "ID",
  };

  return (
    <section>
      <PageHeader title={t.sections["audit-logs"]} onRefresh={list.reload} />
      <form onSubmit={apply} className="mb-4 flex flex-wrap items-end gap-3">
        {FILTERS.map((name) => (
          <label key={name} className="text-sm text-ink-soft">
            <span className="mb-1 block">{labels[name]}</span>
            <input name={name} dir="ltr" maxLength={200} className={inputClass} />
          </label>
        ))}
        <label className="text-sm text-ink-soft">
          <span className="mb-1 block">{a.from}</span>
          <input name="from" type="date" className={inputClass} />
        </label>
        <label className="text-sm text-ink-soft">
          <span className="mb-1 block">{a.to}</span>
          <input name="to" type="date" className={inputClass} />
        </label>
        <Button type="submit">{a.filter}</Button>
      </form>
      <LoadState loading={list.loading} error={list.error} onRetry={list.reload} />
      {list.items?.length === 0 ? <p className="text-ink-soft">{a.empty}</p> : null}
      <ul className="grid gap-2">
        {list.items?.map((entry) => (
          <li key={entry.id}>
            <Entry entry={entry} />
          </li>
        ))}
      </ul>
      <Pager page={page} totalPages={list.totalPages} onPage={setPage} />
    </section>
  );
}

function Entry({ entry }: { entry: AuditLog }) {
  const { a, date } = useAdminT();
  const [open, setOpen] = useState(false);
  const actor =
    entry.actor.type === "SYSTEM"
      ? a.system
      : (entry.actor.displayName ?? `${entry.actor.type} ${entry.actor.id ?? ""}`);
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <div>
          <p dir="ltr" className="text-start font-semibold text-ink">
            {entry.action}
          </p>
          <p dir="ltr" className="text-start text-xs text-ink-soft">
            {entry.entityType} · {entry.entityId}
          </p>
        </div>
        <div className="text-end text-ink-soft">
          <p>{actor}</p>
          <p>{date(entry.createdAt)}</p>
        </div>
      </div>
      {entry.reason ? <p className="mt-2 text-sm text-ink">{entry.reason}</p> : null}
      <div className="mt-2">
        <Button tone="plain" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? a.hide : a.details}
        </Button>
      </div>
      {open ? (
        <div className="mt-2 grid gap-2 md:grid-cols-2">
          <div>
            <p className="mb-1 text-xs text-ink-soft">{a.before}</p>
            <Json value={entry.previousData} />
          </div>
          <div>
            <p className="mb-1 text-xs text-ink-soft">{a.after}</p>
            <Json value={entry.newData} />
          </div>
          {entry.correlationId ? (
            <p dir="ltr" className="text-start text-xs text-ink-soft md:col-span-2">
              Request ID: {entry.correlationId}
            </p>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
