"use client";

import type { PurchaseView } from "@/server/modules/purchasing/purchase-orders-service";
import {
  Button,
  Card,
  Input,
  Table,
  TextArea,
  useAction,
  useCan,
} from "../../../_components/catalog-ui";
import { staffApi, staffPost } from "../../../_lib/api";
import { field } from "../../../_lib/forms";
import { formatPiastres, parsePounds } from "../../../_lib/money";
import { usePurchasingT } from "../../../_lib/purchasing-i18n";

/** Statuses that accept an invoice (API "TASK-023 Amendments"). */
const INVOICEABLE = ["APPROVED", "SENT", "PARTIALLY_RECEIVED", "RECEIVED"];

interface UploadInit {
  mediaAssetId: string;
  upload: { method: string; url: string; headers: Record<string, string> };
}

/**
 * Supplier invoices (Q115, Q117): listed for supplier finance, recorded with
 * the invoice image (upload purpose `SUPPLIER_INVOICE`). Recorded invoices
 * never change.
 */
export function InvoicesCard({
  purchase,
  onChange,
}: {
  purchase: PurchaseView;
  onChange: () => void;
}) {
  const { c, p } = usePurchasingT();
  const can = useCan();
  const { run, pending, notice, fail } = useAction(onChange);
  const record = can("SUPPLIER_PAYMENT_MANAGE") && INVOICEABLE.includes(purchase.status);
  if (!purchase.invoices && !record) {
    return null;
  }
  return (
    <Card title={p.invoices}>
      {notice}
      {purchase.invoices ? (
        <div className="mb-4">
          <Table
            head={[p.invoiceNumber, p.invoiceDate, p.invoiceTotal, p.taxAmount, p.recordedBy, ""]}
          >
            {purchase.invoices.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-ink-soft">
                  {c.empty}
                </td>
              </tr>
            ) : null}
            {purchase.invoices.map((invoice) => (
              <tr key={invoice.id}>
                <td className="px-3 py-2" dir="ltr">
                  {invoice.invoiceNumber}
                </td>
                <td className="px-3 py-2">{invoice.invoiceDate}</td>
                <td className="px-3 py-2">{formatPiastres(invoice.invoiceTotal)}</td>
                <td className="px-3 py-2">{formatPiastres(invoice.taxAmount) ?? "—"}</td>
                <td className="px-3 py-2">{invoice.recordedBy.displayName}</td>
                <td className="px-3 py-2">
                  <a
                    href={invoice.file.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-plum hover:underline"
                  >
                    {p.viewFile}
                  </a>
                </td>
              </tr>
            ))}
          </Table>
        </div>
      ) : null}
      {record ? (
        <form
          className="grid gap-4 rounded-lg border border-line bg-velvet-low p-4 sm:grid-cols-2"
          onSubmit={async (event) => {
            event.preventDefault();
            const element = event.currentTarget;
            const form = new FormData(element);
            const file = form.get("file");
            const total = parsePounds(String(form.get("invoiceTotal") ?? ""));
            const taxText = String(form.get("taxAmount") ?? "").trim();
            const tax = taxText === "" ? null : parsePounds(taxText);
            if (total === null || (taxText !== "" && tax === null)) {
              fail(c.invalidAmount);
              return;
            }
            if (!(file instanceof File) || file.size === 0) return;
            const ok = await run(async () => {
              const init = await staffPost<UploadInit>("/api/v1/files/upload-init", {
                purpose: "SUPPLIER_INVOICE",
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
              await staffPost(`/api/v1/admin/purchases/${purchase.id}/invoice`, {
                invoiceNumber: field(form, "invoiceNumber"),
                invoiceDate: field(form, "invoiceDate"),
                invoiceTotal: total,
                taxAmount: tax,
                mediaAssetId: init.mediaAssetId,
                notes: field(form, "notes"),
              });
            });
            if (ok) element.reset();
          }}
        >
          <Input label={p.invoiceNumber} name="invoiceNumber" required maxLength={100} dir="ltr" />
          <Input label={p.invoiceDate} name="invoiceDate" type="date" required />
          <Input
            label={p.invoiceTotal}
            name="invoiceTotal"
            required
            inputMode="decimal"
            dir="ltr"
          />
          <Input label={p.taxAmount} name="taxAmount" inputMode="decimal" dir="ltr" />
          <label className="block text-sm text-ink-soft sm:col-span-2">
            <span className="mb-1 block">{p.invoiceFile}</span>
            <input
              type="file"
              name="file"
              required
              accept="image/jpeg,image/png,image/webp"
              className="block w-full text-sm"
            />
          </label>
          <div className="sm:col-span-2">
            <TextArea label={p.notes} name="notes" maxLength={2000} />
          </div>
          <div>
            <Button type="submit" disabled={pending}>
              {p.recordInvoice}
            </Button>
          </div>
        </form>
      ) : null}
    </Card>
  );
}
