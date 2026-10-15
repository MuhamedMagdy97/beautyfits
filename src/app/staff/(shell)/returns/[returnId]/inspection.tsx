"use client";

import { useState } from "react";
import type { AdminReturnView } from "@/server/modules/returns/returns-service";
import { Button, Input, Select, useAction } from "../../../_components/catalog-ui";
import { staffApi, staffPost } from "../../../_lib/api";
import { inspectionOutcomes, type OutcomeRow } from "../../../_lib/orders";
import { ordersError, useOrdersT } from "../../../_lib/orders-i18n";

interface UploadInit {
  mediaAssetId: string;
  upload: { method: string; url: string; headers: Record<string, string> };
}

const MAX_PHOTOS = 10;

/**
 * Inspection of one return line (API "TASK-039 Amendments", Q35, Q36): its
 * units split across outcomes, each with a condition, quantity and notes,
 * plus optional staff photos (uploads with purpose `RETURN_INSPECTION`).
 */
export function InspectionForm({
  line,
  onChange,
}: {
  line: AdminReturnView["items"][number];
  onChange: () => void;
}) {
  const { t, c, o } = useOrdersT();
  const { run, pending, notice, fail } = useAction(onChange, (error) =>
    ordersError(t, c, o, error),
  );
  const blank = (quantity: string): OutcomeRow => ({
    result: "RESTOCK",
    condition: "SELLABLE",
    quantity,
    notes: "",
  });
  const [rows, setRows] = useState<OutcomeRow[]>([blank(String(line.requestedQuantity))]);
  const update = (index: number, change: Partial<OutcomeRow>) =>
    setRows(rows.map((row, i) => (i === index ? { ...row, ...change } : row)));

  async function upload(file: File): Promise<string> {
    const init = await staffPost<UploadInit>("/api/v1/files/upload-init", {
      purpose: "RETURN_INSPECTION",
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
    return init.mediaAssetId;
  }

  return (
    <form
      className="mt-3 rounded-lg border border-line bg-velvet-low p-3"
      onSubmit={async (event) => {
        event.preventDefault();
        const checked = inspectionOutcomes(rows, line.requestedQuantity);
        if ("mismatch" in checked) {
          fail(o.outcomesMustAdd.replace("{n}", String(checked.mismatch)));
          return;
        }
        const files = new FormData(event.currentTarget)
          .getAll("photos")
          .filter((file): file is File => file instanceof File && file.size > 0)
          .slice(0, MAX_PHOTOS);
        await run(async () => {
          const evidenceMediaAssetIds: string[] = [];
          for (const file of files) {
            evidenceMediaAssetIds.push(await upload(file));
          }
          await staffPost(`/api/v1/admin/return-items/${line.id}/inspection`, {
            outcomes: checked.outcomes,
            evidenceMediaAssetIds,
          });
        });
      }}
    >
      {notice}
      {rows.map((row, index) => (
        <div
          key={index}
          className="mb-3 grid gap-2 sm:grid-cols-[1fr_1fr_6rem_2fr_auto] sm:items-end"
        >
          <Select
            label={o.result}
            value={row.result}
            onChange={(event) => update(index, { result: event.target.value })}
          >
            {Object.entries(o.results).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
          <Select
            label={o.condition}
            value={row.condition}
            onChange={(event) => update(index, { condition: event.target.value })}
          >
            {Object.entries(o.conditions).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
          <Input
            label={o.quantity}
            inputMode="numeric"
            dir="ltr"
            required
            value={row.quantity}
            onChange={(event) => update(index, { quantity: event.target.value })}
          />
          <Input
            label={o.notesOptional}
            maxLength={2000}
            value={row.notes}
            onChange={(event) => update(index, { notes: event.target.value })}
          />
          {rows.length > 1 ? (
            <Button variant="plain" onClick={() => setRows(rows.filter((_, i) => i !== index))}>
              {o.removeOutcome}
            </Button>
          ) : (
            <span />
          )}
        </div>
      ))}
      <Button variant="plain" onClick={() => setRows([...rows, blank("")])}>
        {o.addOutcome}
      </Button>
      <label className="mt-3 block text-sm text-ink-soft">
        <span className="mb-1 block">{o.photos}</span>
        <input
          type="file"
          name="photos"
          multiple
          accept="image/jpeg,image/png,image/webp"
          className="block w-full text-sm"
        />
        <span className="mt-1 block text-xs">{o.photosHint}</span>
      </label>
      <div className="mt-3">
        <Button type="submit" disabled={pending}>
          {pending ? o.uploading : o.inspect}
        </Button>
      </div>
    </form>
  );
}
