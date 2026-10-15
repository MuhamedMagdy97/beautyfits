"use client";

import { useState } from "react";
import type { DeliveryView } from "@/server/modules/notifications/notifications-service";
import {
  Button,
  Guard,
  Input,
  Loaded,
  PageTitle,
  Pager,
  Select,
  Table,
  useApiData,
} from "../../_components/catalog-ui";
import { parseUuid } from "../../_lib/marketing";
import { useMarketingT } from "../../_lib/marketing-i18n";

const PAGE_SIZE = 50;
const STATUSES = ["PENDING", "SENT", "FAILED", "FALLBACK_SENT"];

/**
 * Notification delivery log (TASK-056 over TASK-045; `NOTIFICATION_LOG_VIEW`).
 * Recipients are shown only to staff with `VIEW_CUSTOMER_CONTACT` (the API
 * leaves them out otherwise).
 */
export function Deliveries({ initialOrderId }: { initialOrderId: string }) {
  return (
    <Guard anyOf={["NOTIFICATION_LOG_VIEW"]}>
      <DeliveryLog initialOrderId={initialOrderId} />
    </Guard>
  );
}

function DeliveryLog({ initialOrderId }: { initialOrderId: string }) {
  const { t, m, date } = useMarketingT();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [channel, setChannel] = useState("");
  const [typedOrder, setTypedOrder] = useState(initialOrderId);
  const [orderId, setOrderId] = useState(parseUuid(initialOrderId) ?? "");
  const query = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
  if (status) query.set("status", status);
  if (channel) query.set("channel", channel);
  if (orderId) query.set("orderId", orderId);
  const { state, reload } = useApiData<DeliveryView[]>(
    `/api/v1/admin/notifications/deliveries?${query}`,
  );

  return (
    <section>
      <PageTitle
        aside={
          <Button variant="plain" onClick={reload}>
            {m.refresh}
          </Button>
        }
      >
        {t.sections.notifications}
      </PageTitle>
      <p className="mb-4 max-w-2xl text-ink-soft">{m.deliveriesIntro}</p>
      <form
        className="mb-4 flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          setPage(1);
          // A malformed id is sent as typed so the API answers with a validation error.
          setOrderId(typedOrder.trim());
        }}
      >
        <Select
          label={m.status}
          value={status}
          onChange={(event) => {
            setPage(1);
            setStatus(event.target.value);
          }}
        >
          <option value="">{m.all}</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {m.deliveryStatuses[s]}
            </option>
          ))}
        </Select>
        <Select
          label={m.channel}
          value={channel}
          onChange={(event) => {
            setPage(1);
            setChannel(event.target.value);
          }}
        >
          <option value="">{m.all}</option>
          <option value="EMAIL">{m.channels.EMAIL}</option>
          <option value="WHATSAPP">{m.channels.WHATSAPP}</option>
        </Select>
        <div className="min-w-72 flex-1">
          <Input
            label={m.orderId}
            dir="ltr"
            value={typedOrder}
            onChange={(event) => setTypedOrder(event.target.value)}
          />
        </div>
        <Button type="submit" variant="plain">
          {m.apply}
        </Button>
      </form>
      <Loaded load={state} reload={reload}>
        {(items) =>
          items.length === 0 ? (
            <p className="text-ink-soft">{m.empty}</p>
          ) : (
            <>
              <Table
                head={[
                  m.created,
                  m.template,
                  m.channel,
                  m.recipient,
                  m.attempt,
                  m.status,
                  m.failure,
                  m.orderId,
                ]}
              >
                {items.map((d) => (
                  <tr key={d.id}>
                    <td className="px-3 py-2 text-xs">
                      {date(d.createdAt)}
                      {d.sentAt ? (
                        <>
                          <br />
                          {m.sentAt}: {date(d.sentAt)}
                        </>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-xs" dir="ltr">
                      {d.templateKey} ({d.locale})
                    </td>
                    <td className="px-3 py-2">{m.channels[d.channel] ?? d.channel}</td>
                    <td className="px-3 py-2 text-xs" dir="ltr">
                      {d.recipient ?? <span className="text-ink-soft">{m.hiddenContact}</span>}
                    </td>
                    <td className="px-3 py-2">{d.attemptNumber}</td>
                    <td
                      className={`px-3 py-2 ${d.status === "FAILED" ? "text-danger" : "text-ink"}`}
                    >
                      {m.deliveryStatuses[d.status] ?? d.status}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {d.failureReason ?? m.none}
                      {d.providerReference ? (
                        <span className="block text-ink-soft" dir="ltr">
                          {m.providerReference}: {d.providerReference}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-xs" dir="ltr">
                      {d.orderId ? (
                        <button
                          type="button"
                          className="text-plum hover:underline"
                          onClick={() => {
                            setPage(1);
                            setTypedOrder(d.orderId!);
                            setOrderId(d.orderId!);
                          }}
                        >
                          {d.orderId.slice(0, 8)}
                        </button>
                      ) : (
                        m.none
                      )}
                    </td>
                  </tr>
                ))}
              </Table>
              <Pager page={page} count={items.length} pageSize={PAGE_SIZE} onPage={setPage} />
            </>
          )
        }
      </Loaded>
    </section>
  );
}
