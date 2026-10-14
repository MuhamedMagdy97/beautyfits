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
  Pager,
  useAdminT,
  useLoad,
  useLoadPage,
  type PersonRef,
} from "../_admin/kit";

/** `GET /admin/settings` item (API "TASK-057 Amendments"). */
interface Setting {
  key: string;
  dataType: "INTEGER" | "BOOLEAN" | "STRING" | "JSON";
  value: unknown;
  defaultValue: unknown;
  critical: boolean;
  unit: string | null;
  options: string[] | null;
  updatedBy: PersonRef | null;
  updatedAt: string | null;
  pendingApproval: { id: string; value: unknown; requestedBy: PersonRef } | null;
}

interface HistoryRow {
  id: string;
  key: string;
  oldValue: unknown;
  newValue: unknown;
  changedBy: PersonRef;
  approvedBy: PersonRef | null;
  createdAt: string;
}

/** Settings screen (TASK-057, Q179–Q181). */
export default function SettingsPage() {
  const { t } = useAdminT();
  return (
    <Guard permission="SETTINGS_VIEW" title={t.sections.settings}>
      <Settings />
    </Guard>
  );
}

function Settings() {
  const { t, a } = useAdminT();
  const { session } = useStaffSession();
  const canManage = session.permissions.includes("SETTINGS_MANAGE");
  const settings = useLoad<Setting[]>("/api/v1/admin/settings");
  const [historyPage, setHistoryPage] = useState(1);
  const history = useLoadPage<HistoryRow>(
    `/api/v1/admin/settings/history?page=${historyPage}&pageSize=20`,
  );
  const reload = () => {
    settings.reload();
    history.reload();
  };

  return (
    <section>
      <PageHeader title={t.sections.settings} intro={a.settingsIntro} onRefresh={reload} />
      <LoadState loading={settings.loading} error={settings.error} onRetry={settings.reload} />
      <ul className="grid gap-3">
        {settings.data?.map((setting) => (
          <li key={setting.key}>
            <SettingCard setting={setting} canManage={canManage} onChanged={reload} />
          </li>
        ))}
      </ul>

      <h2 className="mt-10 mb-3 font-[family-name:var(--font-display)] text-2xl text-ink">
        {a.history}
      </h2>
      <LoadState loading={history.loading} error={history.error} onRetry={history.reload} />
      {history.items && history.items.length === 0 ? (
        <p className="text-ink-soft">{a.empty}</p>
      ) : null}
      {history.items && history.items.length > 0 ? <HistoryTable rows={history.items} /> : null}
      <Pager page={historyPage} totalPages={history.totalPages} onPage={setHistoryPage} />
    </section>
  );
}

function SettingCard({
  setting,
  canManage,
  onChanged,
}: {
  setting: Setting;
  canManage: boolean;
  onChanged: () => void;
}) {
  const { a, fail } = useAdminT();
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<{ tone: "info" | "error"; text: string } | null>(null);
  const unit = setting.unit ? a.units[setting.unit] : "";
  const show = (value: unknown) => `${String(value)}${unit ? ` ${unit}` : ""}`;

  const save = submit(async (form) => {
    const raw = String(form.get("value") ?? "");
    const value = setting.dataType === "INTEGER" ? Number(raw) : raw;
    setPending(true);
    setNotice(null);
    try {
      const result = await staffApi<{ outcome: string }>(
        `/api/v1/admin/settings/${encodeURIComponent(setting.key)}`,
        {
          method: "PATCH",
          body: JSON.stringify({ value, reason: form.get("reason") }),
        },
      );
      setNotice({
        tone: "info",
        text:
          result.outcome === "PENDING_APPROVAL"
            ? a.sentForApproval
            : result.outcome === "UNCHANGED"
              ? a.unchanged
              : a.saved,
      });
      setEditing(false);
      onChanged();
    } catch (error) {
      setNotice({ tone: "error", text: fail(error) });
    } finally {
      setPending(false);
    }
  });

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-ink">{a.settingNames[setting.key] ?? setting.key}</p>
          <p dir="ltr" className="text-start text-xs text-ink-soft">
            {setting.key}
          </p>
          {setting.critical ? (
            <p className="mt-1 inline-block rounded bg-blush px-2 py-0.5 text-xs text-plum">
              {a.critical}
            </p>
          ) : null}
        </div>
        <div className="text-end text-sm">
          <p className="text-lg text-ink">{show(setting.value)}</p>
          <p className="text-ink-soft">
            {a.defaultValue}: {show(setting.defaultValue)}
          </p>
          {setting.updatedBy ? (
            <p className="text-ink-soft">
              {a.lastChange.replace("{who}", setting.updatedBy.displayName)}
            </p>
          ) : null}
        </div>
      </div>
      {setting.pendingApproval ? (
        <p className="mt-3 rounded-md bg-velvet-low px-3 py-2 text-sm text-ink">
          {a.pending
            .replace("{value}", show(setting.pendingApproval.value))
            .replace("{who}", setting.pendingApproval.requestedBy.displayName)}
        </p>
      ) : null}
      <div className="mt-3">
        {notice ? <Notice tone={notice.tone}>{notice.text}</Notice> : null}
        {canManage && !editing && !setting.pendingApproval ? (
          <Button tone="plain" onClick={() => setEditing(true)}>
            {a.edit}
          </Button>
        ) : null}
        {editing ? (
          <form onSubmit={save} className="flex flex-wrap items-end gap-3">
            <label className="text-sm text-ink-soft">
              <span className="mb-1 block">{a.newValue}</span>
              {setting.options ? (
                <select name="value" defaultValue={String(setting.value)} className={inputClass}>
                  {setting.options.map((option) => (
                    <option key={option}>{option}</option>
                  ))}
                </select>
              ) : (
                <input
                  name="value"
                  type="number"
                  step={1}
                  required
                  defaultValue={String(setting.value)}
                  className={inputClass}
                />
              )}
            </label>
            <label className="min-w-48 flex-1 text-sm text-ink-soft">
              <span className="mb-1 block">{a.reasonOptional}</span>
              <input name="reason" maxLength={1000} className={`${inputClass} w-full`} />
            </label>
            <Button type="submit" disabled={pending}>
              {a.save}
            </Button>
            <Button tone="plain" onClick={() => setEditing(false)}>
              {a.cancel}
            </Button>
          </form>
        ) : null}
      </div>
    </Card>
  );
}

function HistoryTable({ rows }: { rows: HistoryRow[] }) {
  const { a, date } = useAdminT();
  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-white">
      <table className="w-full text-sm">
        <thead className="bg-velvet-low text-ink-soft">
          <tr>
            {[a.when, a.setting, a.from, a.to, a.changedBy, a.approvedBy].map((label, i) => (
              <th key={i} className="px-3 py-2 text-start font-normal">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-t border-line">
              <td className="px-3 py-2 whitespace-nowrap">{date(row.createdAt)}</td>
              <td className="px-3 py-2">{a.settingNames[row.key] ?? row.key}</td>
              <td className="px-3 py-2">{String(row.oldValue)}</td>
              <td className="px-3 py-2">{String(row.newValue)}</td>
              <td className="px-3 py-2">{row.changedBy.displayName}</td>
              <td className="px-3 py-2">{row.approvedBy?.displayName ?? a.none}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
