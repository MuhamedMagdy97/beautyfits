"use client";

import { useState } from "react";
import { Notice, submit } from "../../_components/ui";
import { staffApi } from "../../_lib/api";
import { useStaffSession } from "../../_lib/session";
import {
  Button,
  Card,
  Guard,
  inputClass,
  LoadState,
  PageHeader,
  useAdminT,
  useLoad,
} from "../_admin/kit";

/** `role` and permission items (API "TASK-012 Amendments"). */
interface Role {
  id: string;
  name: string;
  description: string | null;
  isSystemRole: boolean;
  permissions: string[];
  employeeCount: number;
}

interface Permission {
  code: string;
  group: string;
  description: string;
  ownerAdminOnly: boolean;
}

/** Roles and their permissions (TASK-057, User Flows §17; ROLE_VIEW / ROLE_MANAGE). */
export default function RolesPage() {
  const { t } = useAdminT();
  return (
    <Guard permission="ROLE_VIEW" title={t.sections.roles}>
      <Roles />
    </Guard>
  );
}

function Roles() {
  const { t, a } = useAdminT();
  const { session } = useStaffSession();
  const canManage = session.permissions.includes("ROLE_MANAGE");
  const roles = useLoad<Role[]>("/api/v1/admin/roles");
  const permissions = useLoad<Permission[]>("/api/v1/admin/permissions");
  const [editing, setEditing] = useState<Role | "new" | null>(null);

  return (
    <section>
      <PageHeader title={t.sections.roles} onRefresh={roles.reload} />
      <LoadState loading={roles.loading} error={roles.error} onRetry={roles.reload} />
      {canManage && !editing && permissions.data ? (
        <div className="mb-4">
          <Button onClick={() => setEditing("new")}>{a.newRole}</Button>
        </div>
      ) : null}
      {editing && permissions.data ? (
        <RoleForm
          role={editing === "new" ? null : editing}
          catalog={permissions.data}
          onDone={(changed) => {
            setEditing(null);
            if (changed) {
              roles.reload();
            }
          }}
        />
      ) : null}
      <ul className="grid gap-3">
        {roles.data?.map((role) => (
          <li key={role.id}>
            <Card>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-ink">{role.name}</p>
                  {role.description ? (
                    <p className="text-sm text-ink-soft">{role.description}</p>
                  ) : null}
                  <p className="mt-1 text-sm text-ink-soft">
                    {a.employees}: {role.employeeCount} · {a.permissions}: {role.permissions.length}
                  </p>
                </div>
                {canManage && !role.isSystemRole && !editing && permissions.data ? (
                  <Button tone="plain" onClick={() => setEditing(role)}>
                    {a.edit}
                  </Button>
                ) : null}
              </div>
              <p dir="ltr" className="mt-2 text-start text-xs break-words text-ink-soft">
                {role.permissions.join(", ") || a.none}
              </p>
            </Card>
          </li>
        ))}
      </ul>
    </section>
  );
}

function RoleForm({
  role,
  catalog,
  onDone,
}: {
  role: Role | null;
  catalog: Permission[];
  onDone: (changed: boolean) => void;
}) {
  const { a, fail } = useAdminT();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const groups = [...new Set(catalog.map((p) => p.group))];

  const save = submit(async (form) => {
    setPending(true);
    setError(null);
    const body = {
      name: String(form.get("name") ?? ""),
      description: String(form.get("description") ?? ""),
      permissions: form.getAll("permissions").map(String),
    };
    try {
      await staffApi(role ? `/api/v1/admin/roles/${role.id}` : "/api/v1/admin/roles", {
        method: role ? "PATCH" : "POST",
        body: JSON.stringify(body),
      });
      onDone(true);
    } catch (failure) {
      setError(fail(failure));
      setPending(false);
    }
  });

  return (
    <form onSubmit={save} className="mb-6 rounded-xl border border-plum bg-white p-4">
      <Notice tone="error">{error}</Notice>
      <div className="flex flex-wrap gap-3">
        <label className="min-w-48 flex-1 text-sm text-ink-soft">
          <span className="mb-1 block">{a.roleName}</span>
          <input
            name="name"
            required
            maxLength={100}
            defaultValue={role?.name}
            className={`${inputClass} w-full`}
          />
        </label>
        <label className="min-w-48 flex-[2] text-sm text-ink-soft">
          <span className="mb-1 block">{a.description}</span>
          <input
            name="description"
            maxLength={500}
            defaultValue={role?.description ?? ""}
            className={`${inputClass} w-full`}
          />
        </label>
      </div>
      <fieldset className="mt-4">
        <legend className="mb-2 text-sm text-ink-soft">{a.permissions}</legend>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {groups.map((group) => (
            <div key={group}>
              <p dir="ltr" className="mb-1 text-start text-xs tracking-wider text-ink-soft">
                {group}
              </p>
              {catalog
                .filter((p) => p.group === group)
                .map((p) => (
                  <label
                    key={p.code}
                    className="flex items-start gap-2 py-0.5 text-sm text-ink"
                    title={p.ownerAdminOnly ? a.ownerAdminOnly : undefined}
                  >
                    <input
                      type="checkbox"
                      name="permissions"
                      value={p.code}
                      disabled={p.ownerAdminOnly}
                      defaultChecked={role?.permissions.includes(p.code)}
                      className="mt-1"
                    />
                    <span dir="ltr" className={p.ownerAdminOnly ? "text-ink-soft" : undefined}>
                      {p.description} <span className="text-xs text-ink-soft">({p.code})</span>
                    </span>
                  </label>
                ))}
            </div>
          ))}
        </div>
      </fieldset>
      <div className="mt-4 flex gap-3">
        <Button type="submit" disabled={pending}>
          {role ? a.save : a.create}
        </Button>
        <Button tone="plain" onClick={() => onDone(false)}>
          {a.cancel}
        </Button>
      </div>
    </form>
  );
}
