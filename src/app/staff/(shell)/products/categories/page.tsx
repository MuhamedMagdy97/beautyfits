"use client";

import { useState } from "react";
import type { CategoryView } from "@/server/modules/catalog/taxonomy-service";
import {
  Button,
  Card,
  CatalogTabs,
  Guard,
  Input,
  Loaded,
  PageTitle,
  Select,
  StatusBadge,
  Table,
  useAction,
  useApiData,
  useCan,
  useLocalName,
} from "../../../_components/catalog-ui";
import { submit } from "../../../_components/ui";
import { staffApi, staffPost } from "../../../_lib/api";
import { useCatalogT } from "../../../_lib/catalog-i18n";
import { field } from "../../../_lib/forms";

/**
 * Category tree (TASK-015): the API returns every category followed by its
 * subcategories, with `depth`; depth and loop limits are checked by the API.
 */
export default function CategoriesPage() {
  return (
    <Guard anyOf={["PRODUCT_VIEW"]}>
      <Categories />
    </Guard>
  );
}

function Categories() {
  const { c } = useCatalogT();
  const can = useCan();
  const name = useLocalName();
  const [editing, setEditing] = useState<CategoryView | "new" | null>(null);
  const { state, reload } = useApiData<CategoryView[]>("/api/v1/admin/categories");
  const manage = can("TAXONOMY_MANAGE");
  const { run, pending, notice } = useAction(reload);

  return (
    <>
      <CatalogTabs />
      <PageTitle
        aside={
          manage && editing === null ? (
            <Button onClick={() => setEditing("new")}>{c.newCategory}</Button>
          ) : null
        }
      >
        {c.categories}
      </PageTitle>
      {notice}
      <Loaded load={state} reload={reload}>
        {(categories) => (
          <>
            {editing !== null ? (
              <CategoryForm
                key={editing === "new" ? "new" : editing.id}
                category={editing === "new" ? null : editing}
                categories={categories}
                onDone={() => {
                  setEditing(null);
                  reload();
                }}
              />
            ) : null}
            <Table head={[c.name, c.slugColumn, c.status, c.productCount, ""]}>
              {categories.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-ink-soft">
                    {c.empty}
                  </td>
                </tr>
              ) : null}
              {categories.map((category) => (
                <tr key={category.id}>
                  <td
                    className="px-3 py-2 font-semibold"
                    style={{ paddingInlineStart: `${category.depth * 1.25}rem` }}
                  >
                    {name(category)}
                  </td>
                  <td className="px-3 py-2" dir="ltr">
                    {category.slug}
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge status={category.status} />
                  </td>
                  <td className="px-3 py-2">{category.productCount}</td>
                  <td className="px-3 py-2 text-end whitespace-nowrap">
                    {manage ? (
                      <span className="inline-flex gap-2">
                        <Button variant="plain" onClick={() => setEditing(category)}>
                          {c.edit}
                        </Button>
                        <Button
                          variant="plain"
                          disabled={pending}
                          onClick={() =>
                            void run(() =>
                              staffApi(`/api/v1/admin/categories/${category.id}`, {
                                method: "PATCH",
                                body: JSON.stringify({
                                  status: category.status === "ACTIVE" ? "INACTIVE" : "ACTIVE",
                                }),
                              }),
                            )
                          }
                        >
                          {category.status === "ACTIVE" ? c.deactivate : c.activate}
                        </Button>
                      </span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </Table>
          </>
        )}
      </Loaded>
    </>
  );
}

function CategoryForm({
  category,
  categories,
  onDone,
}: {
  category: CategoryView | null;
  categories: CategoryView[];
  onDone: () => void;
}) {
  const { c } = useCatalogT();
  const name = useLocalName();
  const { run, pending, notice } = useAction();
  return (
    <Card title={category ? c.edit : c.newCategory}>
      {notice}
      <form
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={submit((form) => {
          const body = {
            nameAr: field(form, "nameAr"),
            nameEn: field(form, "nameEn"),
            slug: field(form, "slug"),
            parentId: field(form, "parentId") ?? null,
          };
          void run(async () => {
            if (category) {
              await staffApi(`/api/v1/admin/categories/${category.id}`, {
                method: "PATCH",
                body: JSON.stringify(body),
              });
            } else {
              await staffPost("/api/v1/admin/categories", body);
            }
            onDone();
          });
        })}
      >
        <Input label={c.nameAr} name="nameAr" required dir="rtl" defaultValue={category?.nameAr} />
        <Input label={c.nameEn} name="nameEn" required dir="ltr" defaultValue={category?.nameEn} />
        <Input label={c.slug} name="slug" dir="ltr" defaultValue={category?.slug} />
        <Select label={c.parent} name="parentId" defaultValue={category?.parentId ?? ""}>
          <option value="">{c.topLevel}</option>
          {categories
            .filter((option) => option.id !== category?.id)
            .map((option) => (
              <option key={option.id} value={option.id}>
                {"— ".repeat(option.depth - 1)}
                {name(option)}
              </option>
            ))}
        </Select>
        <div className="flex gap-2 sm:col-span-2">
          <Button type="submit" disabled={pending}>
            {category ? c.save : c.create}
          </Button>
          <Button variant="plain" onClick={onDone}>
            {c.cancel}
          </Button>
        </div>
      </form>
    </Card>
  );
}
