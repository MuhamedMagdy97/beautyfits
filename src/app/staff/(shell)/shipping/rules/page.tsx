"use client";

import { useState } from "react";
import type { AdminGovernorate } from "@/server/modules/locations/locations-service";
import type {
  ShippingCompanyView,
  ShippingRuleView,
} from "@/server/modules/shipping/shipping-service";
import {
  Button,
  Card,
  Guard,
  Input,
  Loaded,
  PageTitle,
  Pager,
  Select,
  StatusBadge,
  Table,
  useAction,
  useApiData,
  useCan,
} from "../../../_components/catalog-ui";
import { staffApi, staffPost } from "../../../_lib/api";
import { ruleBody, ruleForm, type RuleForm } from "../../../_lib/locations";
import { useLocationsT } from "../../../_lib/locations-i18n";
import { formatPiastres } from "../../../_lib/money";
import { ShippingTabs } from "../tabs";

const PAGE_SIZE = 50;

/**
 * Shipping rules (TASK-055A over TASK-027, ADR-0033, R37): list, create,
 * edit, activate / deactivate. Fees are typed in pounds and sent in piastres;
 * the API validates ranges, periods and references.
 */
export default function RulesPage() {
  return (
    <>
      <ShippingTabs />
      <Guard anyOf={["SHIPPING_VIEW"]}>
        <Rules />
      </Guard>
    </>
  );
}

interface Pickers {
  companies: ShippingCompanyView[];
  governorates: AdminGovernorate[];
}

function Rules() {
  const { c, l, english, date } = useLocationsT();
  const manage = useCan()("SHIPPING_MANAGE");
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({ status: "", governorateId: "", shippingCompanyId: "" });
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ShippingRuleView | null>(null);
  const query = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
  for (const [key, value] of Object.entries(filters)) if (value) query.set(key, value);
  const { state, reload } = useApiData<ShippingRuleView[]>(`/api/v1/admin/shipping/rules?${query}`);
  const companies = useApiData<ShippingCompanyView[]>("/api/v1/admin/shipping/companies");
  const locations = useApiData<AdminGovernorate[]>("/api/v1/admin/locations");
  const { run, pending, notice } = useAction(reload);
  const filter = (key: keyof typeof filters, value: string) => {
    setFilters({ ...filters, [key]: value });
    setPage(1);
  };
  const name = (row: { nameAr: string; nameEn: string; status: string }) =>
    (english ? row.nameEn : row.nameAr) + (row.status === "ACTIVE" ? "" : l.inactiveSuffix);

  return (
    <>
      <PageTitle
        aside={
          manage ? <Button onClick={() => setCreating((open) => !open)}>{l.newRule}</Button> : null
        }
      >
        {l.rules}
      </PageTitle>
      <p className="mb-4 text-sm text-ink-soft">{l.rulesHint}</p>
      <Loaded load={companies.state} reload={companies.reload}>
        {(carriers) => (
          <Loaded load={locations.state} reload={locations.reload}>
            {(governorates) => {
              const pickers = { companies: carriers, governorates };
              const carrierName = (id: string | null) =>
                id ? (carriers.find((x) => x.id === id)?.name ?? id) : l.anyCarrier;
              const where = (rule: ShippingRuleView) => {
                const governorate = governorates.find((g) => g.id === rule.governorateId);
                if (!governorate) return l.everywhere;
                const area = governorate.areas.find((a) => a.id === rule.areaId);
                return area ? `${name(governorate)} — ${name(area)}` : name(governorate);
              };
              const range = (rule: ShippingRuleView) =>
                `${formatPiastres(rule.minOrderTotal) ?? l.noLimit} – ${formatPiastres(rule.maxOrderTotal) ?? l.noLimit}`;
              const period = (rule: ShippingRuleView) =>
                rule.activeFrom || rule.activeTo
                  ? `${rule.activeFrom ? date(rule.activeFrom) : "…"} – ${rule.activeTo ? date(rule.activeTo) : "…"}`
                  : l.always;
              return (
                <>
                  {creating ? (
                    <RuleEditor
                      title={l.newRule}
                      pickers={pickers}
                      onCancel={() => setCreating(false)}
                      onSave={(body) =>
                        staffPost("/api/v1/admin/shipping/rules", body).then(() => {
                          setCreating(false);
                          reload();
                        })
                      }
                    />
                  ) : null}
                  {editing ? (
                    <RuleEditor
                      key={editing.id}
                      title={l.editRule}
                      rule={editing}
                      pickers={pickers}
                      onCancel={() => setEditing(null)}
                      onSave={(body) =>
                        staffApi(`/api/v1/admin/shipping/rules/${editing.id}`, {
                          method: "PATCH",
                          body: JSON.stringify(body),
                        }).then(() => {
                          setEditing(null);
                          reload();
                        })
                      }
                    />
                  ) : null}
                  <div className="mb-4 grid gap-3 sm:grid-cols-3">
                    <Select
                      label={c.status}
                      value={filters.status}
                      onChange={(event) => filter("status", event.target.value)}
                    >
                      <option value="">{c.allStatuses}</option>
                      <option value="ACTIVE">{c.statuses.ACTIVE}</option>
                      <option value="INACTIVE">{c.statuses.INACTIVE}</option>
                    </Select>
                    <Select
                      label={l.governorate}
                      value={filters.governorateId}
                      onChange={(event) => filter("governorateId", event.target.value)}
                    >
                      <option value="">{l.allGovernorates}</option>
                      {governorates.map((g) => (
                        <option key={g.id} value={g.id}>
                          {name(g)}
                        </option>
                      ))}
                    </Select>
                    <Select
                      label={l.carrier}
                      value={filters.shippingCompanyId}
                      onChange={(event) => filter("shippingCompanyId", event.target.value)}
                    >
                      <option value="">{l.allCarriers}</option>
                      {carriers.map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.name}
                        </option>
                      ))}
                    </Select>
                  </div>
                  {notice}
                  <Loaded load={state} reload={reload}>
                    {(rules) => (
                      <>
                        <Table
                          head={[
                            l.governorate,
                            l.carrier,
                            l.orderTotal,
                            l.fee,
                            l.priority,
                            l.period,
                            c.status,
                            manage ? l.actions : "",
                          ]}
                        >
                          {rules.length === 0 ? (
                            <tr>
                              <td colSpan={8} className="px-3 py-6 text-center text-ink-soft">
                                {c.empty}
                              </td>
                            </tr>
                          ) : null}
                          {rules.map((rule) => (
                            <tr key={rule.id}>
                              <td className="px-3 py-2">{where(rule)}</td>
                              <td className="px-3 py-2">{carrierName(rule.shippingCompanyId)}</td>
                              <td className="px-3 py-2 whitespace-nowrap" dir="ltr">
                                {range(rule)}
                              </td>
                              <td className="px-3 py-2 font-semibold" dir="ltr">
                                {formatPiastres(rule.shippingFee)}
                              </td>
                              <td className="px-3 py-2" dir="ltr">
                                {rule.priority}
                              </td>
                              <td className="px-3 py-2 text-xs">{period(rule)}</td>
                              <td className="px-3 py-2">
                                <StatusBadge status={rule.status} />
                              </td>
                              <td className="px-3 py-2">
                                {manage ? (
                                  <div className="flex flex-wrap gap-2">
                                    <Button variant="plain" onClick={() => setEditing(rule)}>
                                      {c.edit}
                                    </Button>
                                    <Button
                                      variant={rule.status === "ACTIVE" ? "danger" : "plain"}
                                      disabled={pending}
                                      onClick={() =>
                                        void run(() =>
                                          staffApi(`/api/v1/admin/shipping/rules/${rule.id}`, {
                                            method: "PATCH",
                                            body: JSON.stringify({
                                              status:
                                                rule.status === "ACTIVE" ? "INACTIVE" : "ACTIVE",
                                            }),
                                          }),
                                        )
                                      }
                                    >
                                      {rule.status === "ACTIVE" ? c.deactivate : c.activate}
                                    </Button>
                                  </div>
                                ) : null}
                              </td>
                            </tr>
                          ))}
                        </Table>
                        <Pager
                          page={page}
                          count={rules.length}
                          pageSize={PAGE_SIZE}
                          onPage={setPage}
                        />
                      </>
                    )}
                  </Loaded>
                </>
              );
            }}
          </Loaded>
        )}
      </Loaded>
    </>
  );
}

function RuleEditor({
  title,
  rule,
  pickers,
  onSave,
  onCancel,
}: {
  title: string;
  rule?: ShippingRuleView;
  pickers: Pickers;
  onSave: (body: Record<string, unknown>) => Promise<unknown>;
  onCancel: () => void;
}) {
  const { c, l, english } = useLocationsT();
  const { run, pending, notice, fail } = useAction();
  const [form, setForm] = useState<RuleForm>(() => ruleForm(rule));
  const set = (key: keyof RuleForm) => (event: { target: { value: string } }) =>
    setForm((current) => ({
      ...current,
      [key]: event.target.value,
      // A different governorate makes the chosen area meaningless.
      ...(key === "governorateId" ? { areaId: "" } : {}),
    }));
  const name = (row: { nameAr: string; nameEn: string; status: string }) =>
    (english ? row.nameEn : row.nameAr) + (row.status === "ACTIVE" ? "" : l.inactiveSuffix);
  const areas = pickers.governorates.find((g) => g.id === form.governorateId)?.areas ?? [];

  return (
    <Card title={title}>
      {notice}
      <form
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          const result = ruleBody(form);
          if ("badField" in result) {
            fail(l.badFields[result.badField] ?? c.conflict);
            return;
          }
          void run(() => onSave(result.body));
        }}
      >
        <Select label={l.governorate} value={form.governorateId} onChange={set("governorateId")}>
          <option value="">{l.everywhere}</option>
          {pickers.governorates.map((g) => (
            <option key={g.id} value={g.id}>
              {name(g)}
            </option>
          ))}
        </Select>
        <Select
          label={l.area}
          value={form.areaId}
          onChange={set("areaId")}
          disabled={!form.governorateId}
        >
          <option value="">{l.wholeGovernorate}</option>
          {areas.map((a) => (
            <option key={a.id} value={a.id}>
              {name(a)}
            </option>
          ))}
        </Select>
        <Select
          label={l.carrier}
          value={form.shippingCompanyId}
          onChange={set("shippingCompanyId")}
        >
          <option value="">{l.anyCarrier}</option>
          {pickers.companies.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name + (x.status === "ACTIVE" ? "" : l.inactiveSuffix)}
            </option>
          ))}
        </Select>
        <Input
          label={l.fee}
          required
          inputMode="decimal"
          dir="ltr"
          value={form.shippingFee}
          onChange={set("shippingFee")}
        />
        <Input
          label={l.minOrderTotal}
          inputMode="decimal"
          dir="ltr"
          value={form.minOrderTotal}
          onChange={set("minOrderTotal")}
        />
        <Input
          label={l.maxOrderTotal}
          inputMode="decimal"
          dir="ltr"
          value={form.maxOrderTotal}
          onChange={set("maxOrderTotal")}
        />
        <p className="text-xs text-ink-soft sm:col-span-2">{l.rangeHint}</p>
        <Input
          label={l.priority}
          type="number"
          min={-1000}
          max={1000}
          step={1}
          dir="ltr"
          value={form.priority}
          onChange={set("priority")}
          title={l.priorityHint}
        />
        <Select label={c.status} value={form.status} onChange={set("status")}>
          <option value="ACTIVE">{c.statuses.ACTIVE}</option>
          <option value="INACTIVE">{c.statuses.INACTIVE}</option>
        </Select>
        <Input
          label={l.activeFrom}
          type="datetime-local"
          value={form.activeFrom}
          onChange={set("activeFrom")}
        />
        <Input
          label={l.activeTo}
          type="datetime-local"
          value={form.activeTo}
          onChange={set("activeTo")}
        />
        <div className="flex gap-2 sm:col-span-2">
          <Button type="submit" disabled={pending}>
            {rule ? c.save : c.create}
          </Button>
          <Button variant="plain" onClick={onCancel}>
            {c.cancel}
          </Button>
        </div>
      </form>
    </Card>
  );
}
