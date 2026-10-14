"use client";

import { useState } from "react";
import { Notice } from "../../_components/ui";
import { staffPost } from "../../_lib/api";
import { useStaffSession } from "../../_lib/session";
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
  type PersonRef,
} from "../_admin/kit";

/** `approvalRequest` (API "TASK-013 Amendments"). */
interface ApprovalRequest {
  id: string;
  approvalType: string;
  entityType: string;
  entityId: string;
  status: string;
  reason: string | null;
  metadata: unknown;
  requestedBy: PersonRef;
  requestedAt: string;
  resolvedBy: PersonRef | null;
  resolvedAt: string | null;
  resolutionReason: string | null;
}

const STATUSES = ["PENDING", "APPROVED", "REJECTED", "CANCELLED"] as const;

/** Approval queue (TASK-057, User Flows §17.3; `APPROVAL_RESOLVE`, Owner/Admin). */
export default function ApprovalsPage() {
  const { t } = useAdminT();
  return (
    <Guard permission="APPROVAL_RESOLVE" title={t.sections.approvals}>
      <Approvals />
    </Guard>
  );
}

function Approvals() {
  const { t, a } = useAdminT();
  const [status, setStatus] = useState<string>("PENDING");
  const [page, setPage] = useState(1);
  const query = new URLSearchParams({ page: String(page), pageSize: "20" });
  if (status) {
    query.set("status", status);
  }
  const list = useLoadPage<ApprovalRequest>(`/api/v1/admin/approval-requests?${query}`);

  return (
    <section>
      <PageHeader title={t.sections.approvals} onRefresh={list.reload} />
      <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label={a.status}>
        {[...STATUSES, ""].map((value) => (
          <Button
            key={value || "all"}
            tone={status === value ? "primary" : "plain"}
            aria-pressed={status === value}
            onClick={() => {
              setStatus(value);
              setPage(1);
            }}
          >
            {value ? a.statuses[value] : a.all}
          </Button>
        ))}
      </div>
      <LoadState loading={list.loading} error={list.error} onRetry={list.reload} />
      {list.items?.length === 0 ? <p className="text-ink-soft">{a.empty}</p> : null}
      <ul className="grid gap-3">
        {list.items?.map((request) => (
          <li key={request.id}>
            <RequestCard request={request} onResolved={list.reload} />
          </li>
        ))}
      </ul>
      <Pager page={page} totalPages={list.totalPages} onPage={setPage} />
    </section>
  );
}

function RequestCard({
  request,
  onResolved,
}: {
  request: ApprovalRequest;
  onResolved: () => void;
}) {
  const { a, fail, date } = useAdminT();
  const { session } = useStaffSession();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const own = request.requestedBy.id === session.employee.id;

  async function resolve(outcome: "approve" | "reject") {
    setPending(true);
    setError(null);
    try {
      await staffPost(`/api/v1/admin/approval-requests/${request.id}/${outcome}`, {
        reason: reason.trim() || null,
      });
      onResolved();
    } catch (failure) {
      setError(fail(failure));
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-ink">
            {a.approvalTypes[request.approvalType] ?? request.approvalType}
          </p>
          <p dir="ltr" className="text-start text-xs text-ink-soft">
            {request.entityType} · {request.entityId}
          </p>
          <p className="mt-1 text-sm text-ink-soft">
            {a.requestedBy}: {request.requestedBy.displayName} · {date(request.requestedAt)}
          </p>
          {request.reason ? <p className="mt-1 text-sm text-ink">{request.reason}</p> : null}
        </div>
        <span className="rounded bg-velvet-low px-2 py-0.5 text-xs text-ink">
          {a.statuses[request.status] ?? request.status}
        </span>
      </div>
      {request.resolvedBy ? (
        <p className="mt-2 text-sm text-ink-soft">
          {a.resolvedBy}: {request.resolvedBy.displayName} · {date(request.resolvedAt)}
          {request.resolutionReason ? ` — ${request.resolutionReason}` : ""}
        </p>
      ) : null}
      <div className="mt-3">
        <Button tone="plain" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? a.hide : a.details}
        </Button>
        {open ? (
          <div className="mt-2">
            <Json value={request.metadata} />
          </div>
        ) : null}
      </div>
      {request.status === "PENDING" ? (
        <div className="mt-3">
          <Notice tone="error">{error}</Notice>
          {own ? (
            <p className="text-sm text-ink-soft">{a.errors.SELF_APPROVAL}</p>
          ) : (
            <div className="flex flex-wrap items-end gap-3">
              <label className="min-w-48 flex-1 text-sm text-ink-soft">
                <span className="mb-1 block">{a.reasonOptional}</span>
                <input
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  maxLength={1000}
                  className={`${inputClass} w-full`}
                />
              </label>
              <Button disabled={pending} onClick={() => void resolve("approve")}>
                {a.approve}
              </Button>
              <Button
                tone="danger"
                disabled={pending || reason.trim() === ""}
                title={a.reasonRequired}
                onClick={() => void resolve("reject")}
              >
                {a.reject}
              </Button>
            </div>
          )}
        </div>
      ) : null}
    </Card>
  );
}
