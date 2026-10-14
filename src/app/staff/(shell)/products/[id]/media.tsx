"use client";

import type { ProductView } from "@/server/modules/catalog/products-service";
import { Button, Card, Input, Select, useAction, useCan } from "../../../_components/catalog-ui";
import { staffApi, staffPost } from "../../../_lib/api";
import { useCatalogT } from "../../../_lib/catalog-i18n";
import { field } from "../../../_lib/forms";

interface UploadInit {
  mediaAssetId: string;
  upload: { method: string; url: string; headers: Record<string, string> };
}

/**
 * Product images (TASK-016): upload (init → send bytes → complete → attach),
 * main image, order and removal. File checks and limits are the API's.
 */
export function MediaCard({
  product,
  onChange,
  readOnly,
}: {
  product: ProductView;
  onChange: () => void;
  readOnly: boolean;
}) {
  const { c, english } = useCatalogT();
  const can = useCan();
  const manage = !readOnly && can("MANAGE_PRODUCT_MEDIA");
  const { run, pending, notice } = useAction(onChange);
  const media = product.media;

  function move(index: number, by: number) {
    const ids = media.map((item) => item.id);
    [ids[index], ids[index + by]] = [ids[index + by], ids[index]];
    void run(() =>
      staffApi(`/api/v1/admin/products/${product.id}/media/order`, {
        method: "PUT",
        body: JSON.stringify({ mediaIds: ids }),
      }),
    );
  }

  return (
    <Card title={c.media}>
      {notice}
      {media.length === 0 ? <p className="mb-4 text-sm text-ink-soft">{c.empty}</p> : null}
      <ul className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {media.map((item, index) => (
          <li key={item.id} className="rounded-lg border border-line p-2">
            {/* eslint-disable-next-line @next/next/no-img-element -- staff-only API file, needs the session cookie */}
            <img
              src={item.url}
              alt={(english ? item.altTextEn : item.altTextAr) ?? ""}
              className="aspect-square w-full rounded object-cover"
            />
            <p className="mt-1 text-xs text-ink-soft">
              {item.isMain ? (
                <span className="font-semibold text-plum">{c.mainImage} · </span>
              ) : null}
              {item.variantId
                ? (product.variants.find((variant) => variant.id === item.variantId)?.sku ?? "")
                : null}
            </p>
            {manage ? (
              <div className="mt-2 flex flex-wrap gap-1">
                {!item.isMain ? (
                  <Button
                    variant="plain"
                    disabled={pending}
                    onClick={() =>
                      void run(() =>
                        staffApi(`/api/v1/admin/products/${product.id}/media/${item.id}`, {
                          method: "PATCH",
                          body: JSON.stringify({ isMain: true }),
                        }),
                      )
                    }
                  >
                    {c.makeMain}
                  </Button>
                ) : null}
                <Button
                  variant="plain"
                  aria-label={c.moveUp}
                  disabled={pending || index === 0}
                  onClick={() => move(index, -1)}
                >
                  ↑
                </Button>
                <Button
                  variant="plain"
                  aria-label={c.moveDown}
                  disabled={pending || index === media.length - 1}
                  onClick={() => move(index, 1)}
                >
                  ↓
                </Button>
                <Button
                  variant="danger"
                  disabled={pending}
                  onClick={() =>
                    void run(() =>
                      staffApi(`/api/v1/admin/products/${product.id}/media/${item.id}`, {
                        method: "DELETE",
                      }),
                    )
                  }
                >
                  {c.remove}
                </Button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      {manage ? <UploadForm product={product} run={run} pending={pending} /> : null}
    </Card>
  );
}

function UploadForm({
  product,
  run,
  pending,
}: {
  product: ProductView;
  run: (action: () => Promise<unknown>) => Promise<boolean>;
  pending: boolean;
}) {
  const { c } = useCatalogT();
  return (
    <form
      className="grid gap-3 rounded-lg border border-line bg-velvet-low p-4 sm:grid-cols-2"
      onSubmit={async (event) => {
        event.preventDefault();
        const element = event.currentTarget;
        const form = new FormData(element);
        const file = form.get("file");
        if (!(file instanceof File) || file.size === 0) return;
        const ok = await run(async () => {
          const init = await staffPost<UploadInit>("/api/v1/files/upload-init", {
            purpose: "PRODUCT_MEDIA",
            filename: file.name,
            mimeType: file.type,
            sizeBytes: file.size,
          });
          await staffApi(init.upload.url, {
            method: init.upload.method,
            headers: init.upload.headers,
            body: file,
          });
          await staffPost("/api/v1/files/complete", { mediaAssetId: init.mediaAssetId });
          await staffPost(`/api/v1/admin/products/${product.id}/media`, {
            mediaAssetId: init.mediaAssetId,
            variantId: field(form, "variantId") ?? null,
            altTextAr: field(form, "altTextAr"),
            altTextEn: field(form, "altTextEn"),
          });
        });
        if (ok) element.reset();
      }}
    >
      <label className="block text-sm text-ink-soft sm:col-span-2">
        <span className="mb-1 block">{c.upload}</span>
        <input
          type="file"
          name="file"
          required
          accept="image/jpeg,image/png,image/webp"
          className="block w-full text-sm"
        />
        <span className="mt-1 block text-xs">{c.uploadHint}</span>
      </label>
      <Input label={c.altTextAr} name="altTextAr" dir="rtl" maxLength={250} />
      <Input label={c.altTextEn} name="altTextEn" dir="ltr" maxLength={250} />
      <Select label={c.variant} name="variantId" defaultValue="">
        <option value="">—</option>
        {product.variants
          .filter((variant) => variant.status === "ACTIVE")
          .map((variant) => (
            <option key={variant.id} value={variant.id}>
              {variant.sku}
            </option>
          ))}
      </Select>
      <div className="flex items-end">
        <Button type="submit" disabled={pending}>
          {pending ? c.uploading : c.upload}
        </Button>
      </div>
    </form>
  );
}
