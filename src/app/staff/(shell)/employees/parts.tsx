"use client";

import { Tabs } from "../../_components/catalog-ui";
import { useAnalyticsT } from "../../_lib/analytics-i18n";
import { useStaffSession } from "../../_lib/session";
import { useLoad } from "../_admin/kit";

/** Shared pieces of the employees screens (TASK-052A over TASK-011/012). */

/** `role` of `GET /admin/roles` (only the fields these screens use). */
interface Role {
  id: string;
  name: string;
  isSystemRole: boolean;
}

/** Levels the API can give (nobody becomes Owner; hierarchy checked server-side, Q65). */
export const ASSIGNABLE_LEVELS = ["ADMIN", "MANAGER", "EMPLOYEE"] as const;

export function EmployeeTabs() {
  const { x } = useAnalyticsT();
  return (
    <Tabs
      label={x.employees}
      tabs={[
        { href: "/staff/employees", label: x.employees },
        { href: "/staff/employees/invitations", label: x.invitations },
      ]}
    />
  );
}

/**
 * Role checkboxes named `roleIds` (system roles cannot be given). Reading
 * roles needs `ROLE_VIEW`; without it the form leaves roles out and says so.
 * A hidden `rolesShown` field tells the form the choice was offered.
 */
export function RolePicker({ checked }: { checked?: string[] }) {
  const { x } = useAnalyticsT();
  const { session } = useStaffSession();
  if (!session.permissions.includes("ROLE_VIEW")) {
    return <p className="text-sm text-ink-soft">{x.rolesNeedRoleView}</p>;
  }
  return <RoleChoices checked={checked} />;
}

function RoleChoices({ checked }: { checked?: string[] }) {
  const { x } = useAnalyticsT();
  const roles = useLoad<Role[]>("/api/v1/admin/roles");
  if (!roles.data) {
    return null;
  }
  return (
    <fieldset>
      <legend className="mb-1 text-sm text-ink-soft">{x.roles}</legend>
      <input type="hidden" name="rolesShown" value="1" />
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {roles.data
          .filter((role) => !role.isSystemRole)
          .map((role) => (
            <label key={role.id} className="flex items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                name="roleIds"
                value={role.id}
                defaultChecked={checked?.includes(role.id)}
              />
              {role.name}
            </label>
          ))}
      </div>
    </fieldset>
  );
}

/** The chosen role ids, or undefined when the choice was not offered. */
export function chosenRoles(form: FormData): string[] | undefined {
  return form.has("rolesShown") ? form.getAll("roleIds").map(String) : undefined;
}
