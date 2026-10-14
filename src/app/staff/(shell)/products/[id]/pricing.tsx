"use client";

import { useState } from "react";
import type { ProductView } from "@/server/modules/catalog/products-service";
import { Button, Card, Input, Table, useAction } from "../../../_components/catalog-ui";
import { submit } from "../../../_components/ui";
import { staffApi, staffPost } from "../../../_lib/api";
import { useCatalogT } from "../../../_lib/catalog-i18n";
import { field } from "../../../_lib/forms";
import { formatBasisPoints, formatPiastres, parsePounds } from "../../../_lib/money";

/** `POST /admin/products/{id}/price-review` response (API "TASK-018 Amendments"). */
interface PriceReview {
  applied: boolean;
  minimumMarginBasisPoints?: number;
  items: {
    variantId: string;
    sku: string;
    currentPrice: number | null;
    proposedPrice: number;
    changes: boolean;
    latestPurchaseCost?: number | null;
    marginBasisPoints?: number | null;
    warnings?: string[];
  }[];
}

/**
 * Selling prices (TASK-018): staff preview new prices, see the API's margin
 * warnings (never blocking), then apply. All checks are the API's.
 */
export function PricesCard({ product, onChange }: { product: ProductView; onChange: () => void }) {
  const { c } = useCatalogT();
  const { run, pending, notice, fail } = useAction();
  const [review, setReview] = useState<PriceReview | null>(null);
  const active = product.variants.filter((variant) => variant.status === "ACTIVE");

  function send(form: FormData, apply: boolean) {
    const items: { variantId: string; sellingPrice: number }[] = [];
    for (const variant of active) {
      const text = field(form, `price-${variant.id}`);
      if (text === undefined) continue;
      const sellingPrice = parsePounds(text);
      if (sellingPrice === null) {
        fail(`${variant.sku}: ${c.invalidAmount}`);
        return;
      }
      items.push({ variantId: variant.id, sellingPrice });
    }
    if (items.length === 0) {
      fail(c.invalidAmount);
      return;
    }
    void run(async () => {
      const result = await staffPost<PriceReview>(
        `/api/v1/admin/products/${product.id}/price-review`,
        { items, apply, reason: field(form, "reason") },
      );
      setReview(result);
      if (result.applied) onChange();
    });
  }

  return (
    <Card title={c.priceReview}>
      <p className="mb-3 text-sm text-ink-soft">{c.priceIntro}</p>
      {notice}
      <form
        onSubmit={submit((form) => send(form, false))}
        onReset={() => setReview(null)}
        className="grid gap-4"
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {active.map((variant) => (
            <Input
              key={variant.id}
              label={`${variant.sku} — ${c.currentPrice}: ${formatPiastres(variant.sellingPrice) ?? c.noPrice}`}
              name={`price-${variant.id}`}
              placeholder={c.newPrice}
              inputMode="decimal"
              dir="ltr"
            />
          ))}
        </div>
        <Input label={c.reasonOptional} name="reason" maxLength={1000} />
        <div className="flex gap-2">
          <Button type="submit" disabled={pending}>
            {c.preview}
          </Button>
          <Button
            variant="plain"
            disabled={pending}
            onClick={(event) => {
              const form = event.currentTarget.form;
              if (form) send(new FormData(form), true);
            }}
          >
            {c.apply}
          </Button>
        </div>
      </form>
      {review ? (
        <div className="mt-4">
          {review.minimumMarginBasisPoints !== undefined ? (
            <p className="mb-2 text-sm text-ink-soft">
              {c.minimumMargin}: {formatBasisPoints(review.minimumMarginBasisPoints)}
            </p>
          ) : null}
          <Table head={[c.sku, c.currentPrice, c.proposedPrice, c.margin, c.warnings]}>
            {review.items.map((item) => (
              <tr key={item.variantId}>
                <td className="px-3 py-2" dir="ltr">
                  {item.sku}
                </td>
                <td className="px-3 py-2" dir="ltr">
                  {formatPiastres(item.currentPrice) ?? c.noPrice}
                </td>
                <td className="px-3 py-2 font-semibold" dir="ltr">
                  {formatPiastres(item.proposedPrice)}
                </td>
                <td className="px-3 py-2" dir="ltr">
                  {formatBasisPoints(item.marginBasisPoints) ?? "—"}
                </td>
                <td className="px-3 py-2 text-danger">
                  {(item.warnings ?? []).map((w) => c.priceWarnings[w] ?? w).join(c.listSeparator)}
                </td>
              </tr>
            ))}
          </Table>
        </div>
      ) : null}
    </Card>
  );
}

/**
 * Opening costs typed by hand (TASK-018): only while no goods receipt has set
 * them (`costsEditable`); a reason is required by the API.
 */
export function CostsCard({ product, onChange }: { product: ProductView; onChange: () => void }) {
  const { c } = useCatalogT();
  const { run, pending, notice, fail } = useAction(onChange);
  const variants = product.variants.filter(
    (variant) => variant.status === "ACTIVE" && variant.costs,
  );
  if (variants.length === 0) {
    return null;
  }
  return (
    <Card title={c.editCosts}>
      {notice}
      <div className="grid gap-4">
        {variants.map((variant) =>
          variant.costs?.costsEditable ? (
            <form
              key={variant.id}
              className="grid items-end gap-3 rounded-lg border border-line p-3 sm:grid-cols-4"
              onSubmit={submit((form) => {
                const body: Record<string, unknown> = { reason: field(form, "reason") ?? "" };
                for (const key of ["latestPurchaseCost", "weightedAverageCost"]) {
                  const text = field(form, key);
                  if (text === undefined) continue;
                  const value = parsePounds(text);
                  if (value === null) {
                    fail(`${variant.sku}: ${c.invalidAmount}`);
                    return;
                  }
                  body[key] = value;
                }
                void run(() =>
                  staffApi(`/api/v1/admin/variants/${variant.id}/cost`, {
                    method: "PATCH",
                    body: JSON.stringify(body),
                  }),
                );
              })}
            >
              <p className="font-semibold sm:col-span-4" dir="ltr">
                {variant.sku}
              </p>
              <Input
                label={c.latestPurchaseCost}
                name="latestPurchaseCost"
                inputMode="decimal"
                dir="ltr"
                defaultValue={formatPiastres(variant.costs.latestPurchaseCost) ?? ""}
              />
              <Input
                label={c.weightedAverageCost}
                name="weightedAverageCost"
                inputMode="decimal"
                dir="ltr"
                defaultValue={formatPiastres(variant.costs.weightedAverageCost) ?? ""}
              />
              <Input label={c.reasonRequired} name="reason" required maxLength={1000} />
              <Button type="submit" disabled={pending}>
                {c.save}
              </Button>
            </form>
          ) : (
            <p key={variant.id} className="text-sm text-ink-soft">
              <span className="font-semibold" dir="ltr">
                {variant.sku}
              </span>
              : {c.costsLocked}
            </p>
          ),
        )}
      </div>
    </Card>
  );
}
