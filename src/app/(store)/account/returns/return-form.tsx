"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, QuantityInput, useRun } from "../../_components/shop";
import { CLAIM_TYPES, uploadReturnPhoto, type ReturnRequest } from "../../_lib/account";
import { storePost } from "../../_lib/api";
import { useT } from "../../_lib/i18n";

export interface ReturnLine {
  orderItemId: string;
  name: string;
  variantName: string | null;
  quantity: number;
}

/**
 * Return request (API "TASK-037 Amendments"): claim type, the customer's own
 * words, the lines and units, and photos. The API checks the window, the
 * returnable units and when photos are required (Q34, Q100, R21).
 * `path` is `POST /orders/{id}/returns`, or `/returns/{id}/resubmit`.
 */
export function ReturnForm({ path, lines }: { path: string; lines: ReturnLine[] }) {
  const t = useT();
  const router = useRouter();
  const { run, pending, notice, say } = useRun();
  const [chosen, setChosen] = useState<Record<string, number>>({});
  const [uploading, setUploading] = useState(false);

  return (
    <form
      method="post"
      className="space-y-4 text-sm"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const items = Object.entries(chosen).map(([orderItemId, quantity]) => ({
          orderItemId,
          quantity,
        }));
        if (items.length === 0) {
          say({ tone: "error", text: t.returnsPage.noItemChosen });
          return;
        }
        const files = form
          .getAll("photos")
          .filter((f): f is File => f instanceof File && f.size > 0);
        void run(async () => {
          setUploading(files.length > 0);
          const evidenceMediaAssetIds: string[] = [];
          try {
            for (const file of files) {
              evidenceMediaAssetIds.push(await uploadReturnPhoto(file));
            }
          } finally {
            setUploading(false);
          }
          const created = await storePost<ReturnRequest>(path, {
            claimType: form.get("claimType"),
            reason: String(form.get("reason") ?? "").trim(),
            items,
            ...(evidenceMediaAssetIds.length > 0 ? { evidenceMediaAssetIds } : {}),
          });
          router.push(`/account/returns/${created.id}`);
        });
      }}
    >
      {notice}
      <p className="text-ink-soft">{t.returnsPage.windowNote}</p>
      <label className="block text-ink-soft">
        <span className="mb-1 block">{t.returnsPage.whatHappened}</span>
        <select
          name="claimType"
          required
          className="block w-full rounded-md border border-line bg-velvet-low px-3 py-2 text-base text-ink"
        >
          {CLAIM_TYPES.map((type) => (
            <option key={type} value={type}>
              {t.returnsPage.claim[type]}
            </option>
          ))}
        </select>
      </label>
      <fieldset className="space-y-2">
        <legend className="mb-1 text-ink-soft">{t.returnsPage.chooseItems}</legend>
        {lines.map((line) => {
          const quantity = chosen[line.orderItemId];
          return (
            <div
              key={line.orderItemId}
              className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-line p-3"
            >
              <label className="flex items-center gap-2 text-ink">
                <input
                  type="checkbox"
                  checked={quantity !== undefined}
                  onChange={(event) => {
                    const next = { ...chosen };
                    if (event.target.checked) {
                      next[line.orderItemId] = line.quantity;
                    } else {
                      delete next[line.orderItemId];
                    }
                    setChosen(next);
                  }}
                />
                <span>
                  {line.name}
                  {line.variantName ? ` — ${line.variantName}` : ""}
                  <span className="block text-xs text-ink-soft">
                    {t.returnsPage.ofOrdered.replace("{n}", String(line.quantity))}
                  </span>
                </span>
              </label>
              {quantity !== undefined && line.quantity > 1 ? (
                <QuantityInput
                  label={t.shop.quantity}
                  value={quantity}
                  onChange={(value) =>
                    setChosen({ ...chosen, [line.orderItemId]: Math.min(value, line.quantity) })
                  }
                />
              ) : null}
            </div>
          );
        })}
      </fieldset>
      <label className="block text-ink-soft">
        <span className="mb-1 block">{t.returnsPage.reason}</span>
        <textarea
          name="reason"
          required
          maxLength={2000}
          rows={3}
          className="block w-full rounded-md border border-line bg-velvet-low px-3 py-2 text-base text-ink"
        />
      </label>
      <label className="block text-ink-soft">
        <span className="mb-1 block">{t.returnsPage.photos}</span>
        <input
          type="file"
          name="photos"
          multiple
          accept="image/jpeg,image/png,image/webp"
          className="block w-full text-ink"
        />
        <span className="mt-1 block text-xs">{t.returnsPage.photosHint}</span>
      </label>
      {uploading ? <p aria-busy>{t.returnsPage.uploading}</p> : null}
      <Button type="submit" variant="primary" disabled={pending}>
        {t.returnsPage.submit}
      </Button>
    </form>
  );
}
