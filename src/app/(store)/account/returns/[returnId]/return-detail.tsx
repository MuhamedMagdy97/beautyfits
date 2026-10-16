"use client";

import Link from "next/link";
import { useState } from "react";
import { Notice } from "@/app/_components/ui";
import {
  Button,
  CustomerOnly,
  Loaded,
  Page,
  PageTitle,
  useRun,
  useStoreData,
} from "../../../_components/shop";
import {
  formatDate,
  snapshotName,
  uploadReturnPhoto,
  type ReturnRequest,
} from "../../../_lib/account";
import { storePost } from "../../../_lib/api";
import { formatMoney } from "../../../_lib/format";
import { useLang, useT } from "../../../_lib/i18n";
import { AccountNav } from "../../account-nav";
import { StatusBadge } from "../../orders/order-list";
import { ReturnForm } from "../return-form";

/**
 * Return detail (API "TASK-037", "TASK-038", "TASK-041" Amendments): status,
 * the reason a request was not accepted, the pickup, and once completed the
 * wallet refund as the API reports it (nothing is computed here).
 */
export function ReturnDetail({ returnId }: { returnId: string }) {
  const t = useT();
  return (
    <Page>
      <PageTitle>{t.my.returns}</PageTitle>
      <AccountNav />
      <CustomerOnly>
        <Detail returnId={returnId} />
      </CustomerOnly>
    </Page>
  );
}

const section = "rounded-xl border border-line bg-white p-5 text-sm";
const heading = "mb-3 font-[family-name:var(--font-display)] text-xl text-plum";

function Detail({ returnId }: { returnId: string }) {
  const t = useT();
  const lang = useLang();
  const { state, reload, set } = useStoreData<ReturnRequest>(`/api/v1/returns/${returnId}`);
  const { run, pending, notice } = useRun();
  const [resubmit, setResubmit] = useState(false);
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);

  return (
    <Loaded load={state} reload={reload}>
      {(request) => (
        <div className="space-y-5">
          <Link href="/account/returns" className="text-sm text-plum hover:underline">
            {t.returnsPage.backToReturns}
          </Link>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-2xl text-ink" dir="ltr">
                {request.returnNumber}
              </h2>
              <p className="text-sm text-ink-soft">
                <Link href={`/account/orders/${request.orderId}`} className="hover:text-plum">
                  {t.returnsPage.forOrder.replace("{number}", request.orderNumber)}
                </Link>{" "}
                · {t.returnsPage.requested.replace("{date}", formatDate(request.createdAt, lang))}
              </p>
            </div>
            <StatusBadge status={t.returnsPage.status[request.status] ?? request.status} />
          </div>
          {notice}
          {request.status === "REJECTED" && request.rejectionReason ? (
            <section className="rounded-xl border border-danger bg-danger-soft p-5 text-sm">
              <h3 className="mb-1 font-semibold text-danger">{t.returnsPage.rejected}</h3>
              <p className="text-ink">{request.rejectionReason}</p>
            </section>
          ) : null}
          {request.pickup ? (
            <section className={section}>
              <h3 className={heading}>{t.returnsPage.pickup}</h3>
              <p>
                {t.returnsPage.pickupBy.replace("{carrier}", request.pickup.shippingCompany.name)}
              </p>
              {request.pickup.trackingNumber ? (
                <p>
                  {t.my.trackingNumber}: <span dir="ltr">{request.pickup.trackingNumber}</span>
                </p>
              ) : null}
              <p className="text-ink-soft">{t.returnsPage.feePayer[request.pickup.feePayer]}</p>
            </section>
          ) : null}
          <section className={section}>
            <dl className="grid gap-2 sm:grid-cols-[160px_1fr]">
              <dt className="text-ink-soft">{t.returnsPage.whatHappened}</dt>
              <dd>{t.returnsPage.claim[request.claimType] ?? request.claimType}</dd>
              <dt className="text-ink-soft">{t.returnsPage.yourReason}</dt>
              <dd className="whitespace-pre-line">{request.reason}</dd>
              <dt className="text-ink-soft">{t.returnsPage.items}</dt>
              <dd>
                <ul>
                  {request.items.map((item) => (
                    <li key={item.id}>
                      {snapshotName(item.productName, lang)}
                      {item.variantName ? ` — ${snapshotName(item.variantName, lang)}` : ""} ×{" "}
                      {item.requestedQuantity}
                    </li>
                  ))}
                </ul>
              </dd>
              <dt className="text-ink-soft">{t.returnsPage.photos}</dt>
              <dd>{t.returnsPage.photoCount.replace("{n}", String(request.evidence.length))}</dd>
            </dl>
          </section>
          {request.refundTotal !== null ? (
            <Notice tone="info">
              {request.refundTotal > 0
                ? t.returnsPage.refunded.replace("{amount}", formatMoney(request.refundTotal, lang))
                : t.returnsPage.noRefund}
            </Notice>
          ) : !["REJECTED", "CANCELLED"].includes(request.status) ? (
            <Notice tone="info">{t.returnsPage.refundNote}</Notice>
          ) : null}

          {request.status === "PENDING_APPROVAL" ? (
            <div className="flex flex-wrap items-start gap-3">
              <label className="text-sm text-ink-soft">
                <span className="mb-1 block">{t.returnsPage.addPhotos}</span>
                <input
                  type="file"
                  multiple
                  accept="image/jpeg,image/png,image/webp"
                  disabled={pending}
                  onChange={(event) => {
                    const files = [...(event.target.files ?? [])];
                    event.target.value = "";
                    void run(async () => {
                      const mediaAssetIds: string[] = [];
                      for (const file of files) {
                        mediaAssetIds.push(await uploadReturnPhoto(file));
                      }
                      set(
                        await storePost<ReturnRequest>(`/api/v1/returns/${request.id}/evidence`, {
                          mediaAssetIds,
                        }),
                      );
                    });
                  }}
                />
              </label>
              {confirmWithdraw ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm">{t.returnsPage.withdrawConfirm}</span>
                  <Button
                    variant="primary"
                    disabled={pending}
                    onClick={() =>
                      void run(async () => {
                        set(await storePost<ReturnRequest>(`/api/v1/returns/${request.id}/cancel`));
                        setConfirmWithdraw(false);
                      })
                    }
                  >
                    {t.returnsPage.withdraw}
                  </Button>
                  <Button onClick={() => setConfirmWithdraw(false)}>{t.accountPage.cancel}</Button>
                </div>
              ) : (
                <Button onClick={() => setConfirmWithdraw(true)}>{t.returnsPage.withdraw}</Button>
              )}
            </div>
          ) : null}

          {request.status === "REJECTED" ? (
            resubmit ? (
              <section className={section}>
                <h3 className={heading}>{t.returnsPage.resubmit}</h3>
                <ReturnForm
                  path={`/api/v1/returns/${request.id}/resubmit`}
                  lines={request.items.map((item) => ({
                    orderItemId: item.orderItemId,
                    name: snapshotName(item.productName, lang) ?? "",
                    variantName: snapshotName(item.variantName, lang),
                    quantity: item.orderedQuantity,
                  }))}
                />
              </section>
            ) : (
              <Button variant="primary" onClick={() => setResubmit(true)}>
                {t.returnsPage.resubmit}
              </Button>
            )
          ) : null}
        </div>
      )}
    </Loaded>
  );
}
