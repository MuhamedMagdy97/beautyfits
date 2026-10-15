"use client";

import { useState } from "react";
import { Table } from "../../../_components/catalog-ui";
import { Notice, submit } from "../../../_components/ui";
import { staffPost } from "../../../_lib/api";
import { useAnalyticsT } from "../../../_lib/analytics-i18n";
import { useStaffSession } from "../../../_lib/session";
import {
  Button,
  Guard,
  inputClass,
  LoadState,
  PageHeader,
  Pager,
  useAdminT,
  useLoadPage,
} from "../../_admin/kit";
import { ASSIGNABLE_LEVELS, chosenRoles, EmployeeTabs, RolePicker } from "../parts";

/** `invitation` of the API ("TASK-012 Amendments"). */
interface Invitation {
  id: string;
  email: string;
  displayName: string;
  level: "ADMIN" | "MANAGER" | "EMPLOYEE";
  roles: { id: string; name: string }[];
  status: "PENDING" | "ACCEPTED" | "REVOKED" | "EXPIRED";
  invitedBy: { id: string; displayName: string };
  expiresAt: string;
}

type Message = { tone: "info" | "error"; text: string } | null;

/**
 * Invitations (TASK-052A over TASK-012): list with `EMPLOYEE_VIEW`; invite
 * and revoke with `EMPLOYEE_MANAGE` within the hierarchy (Q64, Q65).
 */
export default function InvitationsPage() {
  const { t } = useAdminT();
  return (
    <Guard permission="EMPLOYEE_VIEW" title={t.sections.employees}>
      <Invitations />
    </Guard>
  );
}

function Invitations() {
  const { t, a, date } = useAdminT();
  const { x, fail } = useAnalyticsT();
  const { session } = useStaffSession();
  const canManage = session.permissions.includes("EMPLOYEE_MANAGE");
  const [status, setStatus] = useState("PENDING");
  const [page, setPage] = useState(1);
  const [inviting, setInviting] = useState(false);
  const [message, setMessage] = useState<Message>(null);
  const query = new URLSearchParams({ page: String(page), pageSize: "20" });
  if (status) {
    query.set("status", status);
  }
  const list = useLoadPage<Invitation>(`/api/v1/admin/employees/invitations?${query.toString()}`);

  async function revoke(invitation: Invitation) {
    if (!window.confirm(x.confirmRevoke.replace("{email}", invitation.email))) {
      return;
    }
    setMessage(null);
    try {
      await staffPost(`/api/v1/admin/employees/invitations/${invitation.id}/revoke`);
      setMessage({ tone: "info", text: x.revoked });
      list.reload();
    } catch (error) {
      setMessage({ tone: "error", text: fail(error) });
    }
  }

  return (
    <section>
      <PageHeader title={t.sections.employees} onRefresh={list.reload} />
      <EmployeeTabs />
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      {canManage && !inviting ? (
        <div className="mb-4">
          <Button onClick={() => setInviting(true)}>{x.invite}</Button>
        </div>
      ) : null}
      {inviting ? (
        <InviteForm
          onDone={(result) => {
            setInviting(false);
            if (result) {
              setMessage(result);
              list.reload();
            }
          }}
        />
      ) : null}
      <label className="mb-4 inline-block text-sm text-ink-soft">
        <span className="mb-1 block">{x.status}</span>
        <select
          value={status}
          onChange={(event) => {
            setPage(1);
            setStatus(event.target.value);
          }}
          className={inputClass}
        >
          <option value="">{x.all}</option>
          {Object.entries(x.invitationStatuses).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <LoadState loading={list.loading} error={list.error} onRetry={list.reload} />
      {list.items?.length === 0 ? <p className="text-ink-soft">{a.empty}</p> : null}
      {list.items && list.items.length > 0 ? (
        <Table head={[x.name, x.level, x.roles, x.invitedBy, x.expires, x.status, ""]}>
          {list.items.map((invitation) => (
            <tr key={invitation.id}>
              <td className="px-3 py-2">
                <p className="text-ink">{invitation.displayName}</p>
                <p dir="ltr" className="text-start text-xs text-ink-soft">
                  {invitation.email}
                </p>
              </td>
              <td className="px-3 py-2">{t.levels[invitation.level]}</td>
              <td className="px-3 py-2">
                {invitation.roles.map((role) => role.name).join(", ") || x.noRoles}
              </td>
              <td className="px-3 py-2">{invitation.invitedBy.displayName}</td>
              <td className="px-3 py-2 whitespace-nowrap">{date(invitation.expiresAt)}</td>
              <td className="px-3 py-2">{x.invitationStatuses[invitation.status]}</td>
              <td className="px-3 py-2">
                {canManage && invitation.status === "PENDING" ? (
                  <Button tone="danger" onClick={() => void revoke(invitation)}>
                    {x.revoke}
                  </Button>
                ) : null}
              </td>
            </tr>
          ))}
        </Table>
      ) : null}
      <Pager page={page} totalPages={list.totalPages} onPage={setPage} />
    </section>
  );
}

function InviteForm({ onDone }: { onDone: (result: Message) => void }) {
  const { t } = useAdminT();
  const { x, fail } = useAnalyticsT();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = submit(async (form) => {
    setPending(true);
    setError(null);
    try {
      const result = await staffPost<{ emailSent: boolean }>("/api/v1/admin/employees", {
        email: String(form.get("email") ?? "").trim(),
        displayName: String(form.get("displayName") ?? "").trim(),
        department: String(form.get("department") ?? "").trim(),
        level: String(form.get("level") ?? ""),
        roleIds: chosenRoles(form),
      });
      onDone(
        result.emailSent
          ? { tone: "info", text: x.invited }
          : { tone: "error", text: x.inviteEmailFailed },
      );
    } catch (failure) {
      setError(fail(failure));
      setPending(false);
    }
  });

  return (
    <form onSubmit={send} className="mb-6 grid gap-3 rounded-xl border border-plum bg-white p-4">
      <Notice tone="error">{error}</Notice>
      <div className="flex flex-wrap gap-3">
        <label className="min-w-48 flex-1 text-sm text-ink-soft">
          <span className="mb-1 block">{x.email}</span>
          <input
            name="email"
            type="email"
            dir="ltr"
            required
            maxLength={254}
            className={`${inputClass} w-full`}
          />
        </label>
        <label className="min-w-48 flex-1 text-sm text-ink-soft">
          <span className="mb-1 block">{x.name}</span>
          <input name="displayName" required maxLength={100} className={`${inputClass} w-full`} />
        </label>
        <label className="min-w-48 flex-1 text-sm text-ink-soft">
          <span className="mb-1 block">{x.department}</span>
          <input name="department" maxLength={100} className={`${inputClass} w-full`} />
        </label>
        <label className="text-sm text-ink-soft">
          <span className="mb-1 block">{x.level}</span>
          <select name="level" defaultValue="EMPLOYEE" className={inputClass}>
            {ASSIGNABLE_LEVELS.map((level) => (
              <option key={level} value={level}>
                {t.levels[level]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <RolePicker />
      <div className="flex gap-3">
        <Button type="submit" disabled={pending}>
          {x.sendInvite}
        </Button>
        <Button tone="plain" onClick={() => onDone(null)}>
          {x.cancel}
        </Button>
      </div>
    </form>
  );
}
