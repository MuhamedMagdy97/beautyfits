"use client";

import Link from "next/link";
import { useState } from "react";
import type { ProductView, VariantView } from "@/server/modules/catalog/products-service";
import {
  Button,
  Card,
  Input,
  StatusBadge,
  Table,
  TextArea,
  useAction,
  useCan,
} from "../../../_components/catalog-ui";
import { submit } from "../../../_components/ui";
import { staffApi, staffPost } from "../../../_lib/api";
import { useCatalogT } from "../../../_lib/catalog-i18n";
import { field, formatAttributes, optionalInt, parseAttributes } from "../../../_lib/forms";
import { formatBasisPoints, formatPiastres, parsePounds } from "../../../_lib/money";

/** Variants of a product (TASK-014, TASK-018, TASK-019). */
export function VariantsCard({
  product,
  onChange,
  readOnly,
}: {
  product: ProductView;
  onChange: () => void;
  readOnly: boolean;
}) {
  const { c } = useCatalogT();
  const can = useCan();
  const { run, pending, notice } = useAction(onChange);
  const [editing, setEditing] = useState<VariantView | "new" | null>(null);
  const edit = !readOnly && can("PRODUCT_EDIT");
  const archive = !readOnly && can("PRODUCT_ARCHIVE");
  const showCosts = product.variants.some((variant) => variant.costs);

  return (
    <Card title={c.variants}>
      {notice}
      {editing !== null ? (
        <VariantForm
          key={editing === "new" ? "new" : editing.id}
          product={product}
          variant={editing === "new" ? null : editing}
          onDone={(changed) => {
            setEditing(null);
            if (changed) onChange();
          }}
        />
      ) : null}
      <Table
        head={[
          c.sku,
          c.name,
          c.priceShort,
          ...(showCosts ? [c.costs, c.margin] : []),
          c.threshold,
          c.status,
          "",
        ]}
      >
        {product.variants.map((variant) => (
          <tr key={variant.id}>
            <td className="px-3 py-2 font-semibold" dir="ltr">
              {variant.sku}
              {variant.isDefault ? (
                <span className="ms-2 rounded bg-velvet-low px-1.5 text-xs text-plum">
                  {c.default}
                </span>
              ) : null}
            </td>
            <td className="px-3 py-2">
              {[variant.nameAr, variant.nameEn].filter(Boolean).join(" / ") || "—"}
              {variant.attributes ? (
                <span className="block text-xs text-ink-soft">
                  {formatAttributes(variant.attributes).replaceAll("\n", " · ")}
                </span>
              ) : null}
            </td>
            <td className="px-3 py-2" dir="ltr">
              {formatPiastres(variant.sellingPrice) ?? c.noPrice}
            </td>
            {showCosts ? (
              <>
                <td className="px-3 py-2 text-xs" dir="ltr">
                  {formatPiastres(variant.costs?.latestPurchaseCost) ?? "—"} /{" "}
                  {formatPiastres(variant.costs?.weightedAverageCost) ?? "—"}
                </td>
                <td className="px-3 py-2" dir="ltr">
                  {formatBasisPoints(variant.costs?.marginBasisPoints) ?? "—"}
                </td>
              </>
            ) : null}
            <td className="px-3 py-2">{variant.lowStockThreshold ?? "—"}</td>
            <td className="px-3 py-2">
              <StatusBadge status={variant.status} />
            </td>
            <td className="px-3 py-2 text-end whitespace-nowrap">
              <span className="inline-flex flex-wrap justify-end gap-2">
                {can("INVENTORY_VIEW") ? (
                  <Link
                    href={`/staff/inventory/${variant.id}`}
                    className="px-2 py-1.5 text-sm text-plum hover:underline"
                  >
                    {c.viewInventory}
                  </Link>
                ) : null}
                {edit && variant.status === "ACTIVE" ? (
                  <Button variant="plain" onClick={() => setEditing(variant)}>
                    {c.edit}
                  </Button>
                ) : null}
                {edit && variant.status === "ACTIVE" && !variant.isDefault ? (
                  <Button
                    variant="plain"
                    disabled={pending}
                    onClick={() =>
                      void run(() =>
                        staffApi(`/api/v1/admin/variants/${variant.id}`, {
                          method: "PATCH",
                          body: JSON.stringify({ isDefault: true }),
                        }),
                      )
                    }
                  >
                    {c.makeDefault}
                  </Button>
                ) : null}
                {archive && variant.status === "ACTIVE" && !variant.isDefault ? (
                  <Button
                    variant="danger"
                    disabled={pending}
                    onClick={() =>
                      void run(() => staffPost(`/api/v1/admin/variants/${variant.id}/archive`))
                    }
                  >
                    {c.archive}
                  </Button>
                ) : null}
              </span>
            </td>
          </tr>
        ))}
      </Table>
      {!readOnly && can("PRODUCT_CREATE") && editing === null ? (
        <div className="mt-4">
          <Button variant="plain" onClick={() => setEditing("new")}>
            {c.newVariant}
          </Button>
        </div>
      ) : null}
    </Card>
  );
}

function VariantForm({
  product,
  variant,
  onDone,
}: {
  product: ProductView;
  variant: VariantView | null;
  onDone: (changed: boolean) => void;
}) {
  const { c } = useCatalogT();
  const can = useCan();
  const { run, pending, notice, fail } = useAction();
  const withPrice = variant === null && can("EDIT_PRODUCT_PRICE");

  return (
    <div className="mb-4 rounded-lg border border-line bg-velvet-low p-4">
      {notice}
      <form
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={submit((form) => {
          // Names come in pairs (both or neither); blank sends null.
          const body: Record<string, unknown> = {
            sku: field(form, "sku"),
            nameAr: field(form, "nameAr") ?? null,
            nameEn: field(form, "nameEn") ?? null,
            attributes: parseAttributes(String(form.get("attributes") ?? "")),
          };
          if (variant) {
            body.lowStockThreshold = optionalInt(String(form.get("lowStockThreshold") ?? ""));
          }
          const priceText = field(form, "price");
          if (withPrice && priceText !== undefined) {
            const price = parsePounds(priceText);
            if (price === null) {
              fail(c.invalidAmount);
              return;
            }
            body.sellingPrice = price;
          }
          void run(async () => {
            if (variant) {
              await staffApi(`/api/v1/admin/variants/${variant.id}`, {
                method: "PATCH",
                body: JSON.stringify(body),
              });
            } else {
              await staffPost(`/api/v1/admin/products/${product.id}/variants`, body);
            }
            onDone(true);
          });
        })}
      >
        <Input label={c.sku} name="sku" required dir="ltr" defaultValue={variant?.sku} />
        {withPrice ? <Input label={c.price} name="price" inputMode="decimal" dir="ltr" /> : null}
        {variant ? (
          <Input
            label={c.lowStockThreshold}
            name="lowStockThreshold"
            inputMode="numeric"
            dir="ltr"
            defaultValue={variant.lowStockThreshold ?? ""}
          />
        ) : null}
        <Input label={c.nameAr} name="nameAr" dir="rtl" defaultValue={variant?.nameAr ?? ""} />
        <Input label={c.nameEn} name="nameEn" dir="ltr" defaultValue={variant?.nameEn ?? ""} />
        <div className="sm:col-span-2">
          <TextArea
            label={c.attributes}
            name="attributes"
            dir="auto"
            defaultValue={formatAttributes(variant?.attributes ?? null)}
          />
        </div>
        <div className="flex gap-2 sm:col-span-2">
          <Button type="submit" disabled={pending}>
            {variant ? c.save : c.create}
          </Button>
          <Button variant="plain" onClick={() => onDone(false)}>
            {c.cancel}
          </Button>
        </div>
      </form>
    </div>
  );
}
