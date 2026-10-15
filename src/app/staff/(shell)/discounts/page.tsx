"use client";

import { useState } from "react";
import type { DiscountView } from "@/server/modules/discounts/discounts-service";
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
} from "../../_components/catalog-ui";
import { staffApi, staffPost } from "../../_lib/api";
import { discountBody, discountForm, type DiscountForm } from "../../_lib/marketing";
import { useMarketingT } from "../../_lib/marketing-i18n";
import { ProductPicker, TaxonomyPicker } from "./targets";

const PAGE_SIZE = 20;

/**
 * Discounts (TASK-056 over the TASK-026 endpoints, API §23): list and search,
 * create, edit, activate and deactivate. `DISCOUNT_VIEW` reads,
 * `DISCOUNT_MANAGE` changes; the API decides and validates (R36 etc.).
 */
export default function DiscountsPage() {
  return (
    <Guard anyOf={["DISCOUNT_VIEW"]}>
      <Discounts />
    </Guard>
  );
}

function Discounts() {
  const { t, m, date } = useMarketingT();
  const can = useCan();
  const [page, setPage] = useState(1);
  const [typed, setTyped] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [editing, setEditing] = useState<DiscountView | "new" | null>(null);
  const query = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
  if (search) query.set("search", search);
  if (status) query.set("status", status);
  const { state, reload } = useApiData<DiscountView[]>(`/api/v1/admin/discounts?${query}`);
  const action = useAction(reload);
  const manage = can("DISCOUNT_MANAGE");

  return (
    <section>
      <PageTitle
        aside={
          manage && editing === null ? (
            <Button onClick={() => setEditing("new")}>{m.newDiscount}</Button>
          ) : null
        }
      >
        {t.sections.discounts}
      </PageTitle>
      <p className="mb-4 max-w-2xl text-ink-soft">{m.discountsIntro}</p>
      {editing !== null ? (
        <DiscountEditor
          key={editing === "new" ? "new" : editing.id}
          discount={editing === "new" ? undefined : editing}
          onDone={() => {
            setEditing(null);
            reload();
          }}
          onCancel={() => setEditing(null)}
        />
      ) : null}
      <form
        className="mb-4 flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          setPage(1);
          setSearch(typed.trim());
        }}
      >
        <div className="min-w-48 flex-1">
          <Input
            label={m.searchDiscounts}
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
          />
        </div>
        <Select
          label={m.status}
          value={status}
          onChange={(event) => {
            setPage(1);
            setStatus(event.target.value);
          }}
        >
          <option value="">{m.all}</option>
          <option value="ACTIVE">{m.discountStatuses.ACTIVE}</option>
          <option value="INACTIVE">{m.discountStatuses.INACTIVE}</option>
        </Select>
        <Button type="submit" variant="plain">
          {m.search}
        </Button>
      </form>
      {action.notice}
      <Loaded load={state} reload={reload}>
        {(discounts) =>
          discounts.length === 0 ? (
            <p className="text-ink-soft">{m.empty}</p>
          ) : (
            <>
              <Table head={[m.code, m.name, m.percent, m.scope, m.period, m.used, m.status, ""]}>
                {discounts.map((d) => (
                  <tr key={d.id}>
                    <td className="px-3 py-2" dir="ltr">
                      {d.code ?? <span className="text-ink-soft">{m.noCode}</span>}
                    </td>
                    <td className="px-3 py-2">
                      {d.nameEn === d.nameAr ? d.nameEn : `${d.nameAr} / ${d.nameEn}`}
                    </td>
                    <td className="px-3 py-2">{d.value}%</td>
                    <td className="px-3 py-2">{m.scopes[d.scope]}</td>
                    <td className="px-3 py-2 text-xs">
                      {date(d.startsAt)}
                      <br />
                      {d.endsAt ? date(d.endsAt) : m.none}
                    </td>
                    <td className="px-3 py-2">
                      {d.usedCount}
                      {d.usageLimitTotal !== null ? ` / ${d.usageLimitTotal}` : ""}
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge status={d.status} />
                    </td>
                    <td className="px-3 py-2">
                      {manage ? (
                        <div className="flex flex-wrap gap-2">
                          <Button variant="plain" onClick={() => setEditing(d)}>
                            {m.edit}
                          </Button>
                          <Button
                            variant={d.status === "ACTIVE" ? "danger" : "primary"}
                            disabled={action.pending}
                            onClick={() =>
                              void action.run(() =>
                                staffPost(
                                  `/api/v1/admin/discounts/${d.id}/${d.status === "ACTIVE" ? "deactivate" : "activate"}`,
                                ),
                              )
                            }
                          >
                            {d.status === "ACTIVE" ? m.deactivate : m.activate}
                          </Button>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </Table>
              <Pager page={page} count={discounts.length} pageSize={PAGE_SIZE} onPage={setPage} />
            </>
          )
        }
      </Loaded>
    </section>
  );
}

function DiscountEditor({
  discount,
  onDone,
  onCancel,
}: {
  discount?: DiscountView;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { m } = useMarketingT();
  const [form, setForm] = useState<DiscountForm>(() => discountForm(discount));
  const action = useAction(onDone);
  const set =
    <K extends keyof DiscountForm>(key: K) =>
    (value: DiscountForm[K]) =>
      setForm({ ...form, [key]: value });
  const text = (key: keyof DiscountForm) => ({
    value: form[key] as string,
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => set(key)(event.target.value),
  });

  function save(event: React.FormEvent) {
    event.preventDefault();
    const result = discountBody(form);
    if ("error" in result) {
      action.fail(m[result.error]);
      return;
    }
    void action.run(() =>
      discount
        ? staffApi(`/api/v1/admin/discounts/${discount.id}`, {
            method: "PATCH",
            body: JSON.stringify(result.body),
          })
        : staffPost("/api/v1/admin/discounts", result.body),
    );
  }

  return (
    <Card title={discount ? m.editDiscount : m.newDiscount}>
      <form className="grid gap-4" onSubmit={save}>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Input label={m.code} dir="ltr" maxLength={32} {...text("code")} />
            <p className="mt-1 text-xs text-ink-soft">{m.codeHint}</p>
          </div>
          <Input
            label={m.percent}
            type="number"
            min={1}
            max={100}
            required
            inputMode="numeric"
            {...text("value")}
          />
          <Input label={m.nameAr} dir="rtl" required maxLength={200} {...text("nameAr")} />
          <Input label={m.nameEn} dir="ltr" required maxLength={200} {...text("nameEn")} />
          <Input label={m.maxDiscount} inputMode="decimal" {...text("maxDiscount")} />
          <Input label={m.minimumOrder} inputMode="decimal" {...text("minimumOrder")} />
          <Input label={m.startsAt} type="datetime-local" required {...text("startsAt")} />
          <Input label={m.endsAt} type="datetime-local" {...text("endsAt")} />
          <Input label={m.usageTotal} type="number" min={1} {...text("usageTotal")} />
          <Input label={m.usagePerCustomer} type="number" min={1} {...text("usagePerCustomer")} />
        </div>
        <Select
          label={m.scope}
          value={form.scope}
          onChange={(event) => set("scope")(event.target.value as DiscountForm["scope"])}
        >
          <option value="STORE_WIDE">{m.scopes.STORE_WIDE}</option>
          <option value="TARGETED">{m.scopes.TARGETED}</option>
        </Select>
        {form.scope === "TARGETED" ? (
          <div className="grid gap-4">
            <ProductPicker value={form.productIds} onChange={set("productIds")} />
            <div className="grid gap-4 md:grid-cols-2">
              <TaxonomyPicker
                kind="categories"
                value={form.categoryIds}
                onChange={set("categoryIds")}
              />
              <TaxonomyPicker kind="brands" value={form.brandIds} onChange={set("brandIds")} />
            </div>
          </div>
        ) : null}
        {action.notice}
        <div className="flex gap-2">
          <Button type="submit" disabled={action.pending}>
            {m.save}
          </Button>
          <Button variant="plain" onClick={onCancel}>
            {m.cancel}
          </Button>
        </div>
      </form>
    </Card>
  );
}
