"use client";

import { useState } from "react";
import { Table } from "../../_components/catalog-ui";
import { Notice, submit } from "../../_components/ui";
import { staffApi, staffPost } from "../../_lib/api";
import { useAnalyticsT } from "../../_lib/analytics-i18n";
import { useStaffSession } from "../../_lib/session";
import {
  Button,
  Guard,
  inputClass,
  LoadState,
  PageHeader,
  Pager,
  useAdminT,
  useLoadPage,
} from "../_admin/kit";
import { ASSIGNABLE_LEVELS, chosenRoles, EmployeeTabs, RolePicker } from "./parts";

/** `employee` of the API ("TASK-012 Amendments"). */
interface Employee {
  id: string;
  email: string;
  displayName: string;
  level: "OWNER" | "ADMIN" | "MANAGER" | "EMPLOYEE";
  department: string | null;
  status: "ACTIVE" | "DEACTIVATED";
  roles: { id: string; name: string }[];
  createdAt: string;
  deactivatedAt: string | null;
}

/**
 * Employees (TASK-052A over TASK-011/012; `EMPLOYEE_VIEW`, changes with
 * `EMPLOYEE_MANAGE`). The API applies the hierarchy (Q65) and answers why
 * it refuses.
 */
export default function EmployeesPage() {
  const { t } = useAdminT();
  return (
    <Guard permission="EMPLOYEE_VIEW" title={t.sections.employees}>
      <Employees />
    </Guard>
  );
}

function Employees() {
  const { t, a } = useAdminT();
  const { x } = useAnalyticsT();
  const [filters, setFilters] = useState({ search: "", status: "", level: "" });
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const query = new URLSearchParams({ page: String(page), pageSize: "20" });
  for (const [key, value] of Object.entries(filters)) {
    if (value) {
      query.set(key, value);
    }
  }
  const list = useLoadPage<Employee>(`/api/v1/admin/employees?${query.toString()}`);

  return (
    <section>
      <PageHeader title={t.sections.employees} onRefresh={list.reload} />
      <EmployeeTabs />
      <form
        className="mb-4 flex flex-wrap items-end gap-3"
        onSubmit={submit((form) => {
          setPage(1);
          setFilters({
            search: String(form.get("search") ?? "").trim(),
            status: String(form.get("status") ?? ""),
            level: String(form.get("level") ?? ""),
          });
        })}
      >
        <label className="text-sm text-ink-soft">
          <span className="mb-1 block">{x.search}</span>
          <input name="search" maxLength={100} className={inputClass} />
        </label>
        <label className="text-sm text-ink-soft">
          <span className="mb-1 block">{x.status}</span>
          <select name="status" className={inputClass}>
            <option value="">{x.all}</option>
            {Object.entries(x.employeeStatuses).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm text-ink-soft">
          <span className="mb-1 block">{x.level}</span>
          <select name="level" className={inputClass}>
            <option value="">{x.all}</option>
            {Object.entries(t.levels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit">{a.filter}</Button>
      </form>
      <LoadState loading={list.loading} error={list.error} onRetry={list.reload} />
      {list.items?.length === 0 ? <p className="text-ink-soft">{a.empty}</p> : null}
      {list.items && list.items.length > 0 ? (
        <Table head={[x.name, x.level, x.department, x.roles, x.status, ""]}>
          {list.items.map((employee) => (
            <EmployeeRow
              key={employee.id}
              employee={employee}
              open={open === employee.id}
              onToggle={() => setOpen(open === employee.id ? null : employee.id)}
              onChanged={list.reload}
            />
          ))}
        </Table>
      ) : null}
      <Pager page={page} totalPages={list.totalPages} onPage={setPage} />
    </section>
  );
}

function EmployeeRow({
  employee,
  open,
  onToggle,
  onChanged,
}: {
  employee: Employee;
  open: boolean;
  onToggle: () => void;
  onChanged: () => void;
}) {
  const { t, date } = useAdminT();
  const { x } = useAnalyticsT();
  return (
    <>
      <tr>
        <td className="px-3 py-2">
          <p className="text-ink">{employee.displayName}</p>
          <p dir="ltr" className="text-start text-xs text-ink-soft">
            {employee.email}
          </p>
        </td>
        <td className="px-3 py-2">{t.levels[employee.level]}</td>
        <td className="px-3 py-2">{employee.department ?? "—"}</td>
        <td className="px-3 py-2">
          {employee.roles.map((role) => role.name).join(", ") || x.noRoles}
        </td>
        <td className="px-3 py-2">{x.employeeStatuses[employee.status]}</td>
        <td className="px-3 py-2">
          <Button tone="plain" aria-expanded={open} onClick={onToggle}>
            {open ? x.hide : x.details}
          </Button>
        </td>
      </tr>
      {open ? (
        <tr>
          <td colSpan={6} className="bg-velvet-low px-3 py-3">
            <dl className="mb-3 grid gap-2 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-ink-soft">{x.joined}</dt>
                <dd>{date(employee.createdAt)}</dd>
              </div>
              {employee.deactivatedAt ? (
                <div>
                  <dt className="text-ink-soft">{x.deactivatedAt}</dt>
                  <dd>{date(employee.deactivatedAt)}</dd>
                </div>
              ) : null}
            </dl>
            <Manage employee={employee} onChanged={onChanged} />
          </td>
        </tr>
      ) : null}
    </>
  );
}

/**
 * Edit and deactivate, offered with `EMPLOYEE_MANAGE` for active non-Owner
 * employees (nobody manages the Owner, Q65); the API checks the rest.
 */
function Manage({ employee, onChanged }: { employee: Employee; onChanged: () => void }) {
  const { t, a } = useAdminT();
  const { x, fail } = useAnalyticsT();
  const { session } = useStaffSession();
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<{ tone: "info" | "error"; text: string } | null>(null);
  const canManage =
    session.permissions.includes("EMPLOYEE_MANAGE") &&
    employee.level !== "OWNER" &&
    employee.status === "ACTIVE";

  async function run(action: () => Promise<unknown>, success: string) {
    setPending(true);
    setNotice(null);
    try {
      await action();
      setNotice({ tone: "info", text: success });
      setEditing(false);
      onChanged();
    } catch (error) {
      setNotice({ tone: "error", text: fail(error) });
    } finally {
      setPending(false);
    }
  }

  const save = submit((form) => {
    const changes: Record<string, unknown> = {};
    const displayName = String(form.get("displayName") ?? "").trim();
    const department = String(form.get("department") ?? "").trim();
    const level = String(form.get("level") ?? "");
    const roleIds = chosenRoles(form);
    if (displayName !== employee.displayName) changes.displayName = displayName;
    if (department !== (employee.department ?? "")) changes.department = department;
    if (level !== employee.level) changes.level = level;
    const current = employee.roles.map((role) => role.id).sort();
    if (roleIds && roleIds.slice().sort().join() !== current.join()) changes.roleIds = roleIds;
    if (Object.keys(changes).length === 0) {
      setEditing(false);
      return;
    }
    void run(
      () =>
        staffApi(`/api/v1/admin/employees/${employee.id}`, {
          method: "PATCH",
          body: JSON.stringify(changes),
        }),
      a.saved,
    );
  });

  return (
    <div>
      {notice ? <Notice tone={notice.tone}>{notice.text}</Notice> : null}
      {editing ? (
        <form onSubmit={save} className="grid gap-3 rounded-xl border border-plum bg-white p-4">
          <div className="flex flex-wrap gap-3">
            <label className="min-w-48 flex-1 text-sm text-ink-soft">
              <span className="mb-1 block">{x.name}</span>
              <input
                name="displayName"
                required
                maxLength={100}
                defaultValue={employee.displayName}
                className={`${inputClass} w-full`}
              />
            </label>
            <label className="min-w-48 flex-1 text-sm text-ink-soft">
              <span className="mb-1 block">{x.department}</span>
              <input
                name="department"
                maxLength={100}
                defaultValue={employee.department ?? ""}
                className={`${inputClass} w-full`}
              />
            </label>
            <label className="text-sm text-ink-soft">
              <span className="mb-1 block">{x.level}</span>
              <select name="level" defaultValue={employee.level} className={inputClass}>
                {ASSIGNABLE_LEVELS.map((level) => (
                  <option key={level} value={level}>
                    {t.levels[level]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <RolePicker checked={employee.roles.map((role) => role.id)} />
          <div className="flex gap-3">
            <Button type="submit" disabled={pending}>
              {x.save}
            </Button>
            <Button tone="plain" onClick={() => setEditing(false)}>
              {x.cancel}
            </Button>
          </div>
        </form>
      ) : canManage ? (
        <div className="flex flex-wrap gap-3">
          <Button tone="plain" onClick={() => setEditing(true)}>
            {x.edit}
          </Button>
          <Button
            tone="danger"
            disabled={pending}
            onClick={() => {
              if (window.confirm(x.confirmDeactivate.replace("{name}", employee.displayName))) {
                void run(
                  () => staffPost(`/api/v1/admin/employees/${employee.id}/deactivate`),
                  x.deactivated,
                );
              }
            }}
          >
            {x.deactivate}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
