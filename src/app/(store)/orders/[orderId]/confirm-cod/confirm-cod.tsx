"use client";

import { useState } from "react";
import { StatusPanel } from "@/app/_components/ui";
import { Button, Page, PageTitle, useRun } from "../../../_components/shop";
import { StoreApiError, storePost } from "../../../_lib/api";
import { errorMessage, useT } from "../../../_lib/i18n";

/**
 * COD confirmation (API "TASK-031 Amendments"): the token stays in the URL
 * fragment, so it never reaches server logs; the customer confirms with one
 * explicit click. The answer shows no status, tracking or cancellation (R16).
 */
export function ConfirmCod({ orderId }: { orderId: string }) {
  const t = useT();
  const { run, pending, say, notice } = useRun();
  const [confirmed, setConfirmed] = useState<string | null>(null);

  if (confirmed) {
    return (
      <Page>
        <StatusPanel title={t.codConfirm.done.replace("{number}", confirmed)} />
      </Page>
    );
  }
  return (
    <Page>
      <PageTitle>{t.codConfirm.title}</PageTitle>
      <div className="max-w-xl space-y-4 rounded-xl border border-line bg-white p-6">
        {notice}
        <p className="text-sm text-ink-soft">{t.codConfirm.intro}</p>
        <Button
          variant="primary"
          disabled={pending}
          onClick={() => {
            const token = new URLSearchParams(window.location.hash.slice(1)).get("token");
            if (!token) {
              say({ tone: "error", text: t.codConfirm.badLink });
              return;
            }
            void run(async () => {
              try {
                const result = await storePost<{ orderNumber: string }>(
                  `/api/v1/orders/${encodeURIComponent(orderId)}/confirm-cod`,
                  { token },
                );
                setConfirmed(result.orderNumber);
              } catch (error) {
                const known =
                  error instanceof StoreApiError &&
                  { NOT_FOUND: t.codConfirm.badLink, ORDER_STATE_INVALID: t.codConfirm.tooLate }[
                    error.code
                  ];
                say({ tone: "error", text: known || errorMessage(t, error) });
              }
            });
          }}
        >
          {t.codConfirm.confirm}
        </Button>
      </div>
    </Page>
  );
}
