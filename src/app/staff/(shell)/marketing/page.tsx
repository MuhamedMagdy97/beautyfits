"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { CampaignSummaryView } from "@/server/modules/marketing/campaigns-service";
import {
  Button,
  Guard,
  Loaded,
  PageTitle,
  Pager,
  Select,
  Table,
  useApiData,
  useCan,
} from "../../_components/catalog-ui";
import { useMarketingT } from "../../_lib/marketing-i18n";
import { CampaignEditor } from "./editor";

const PAGE_SIZE = 20;
const STATUSES = ["DRAFT", "PENDING_APPROVAL", "APPROVED", "SENDING", "COMPLETED", "FAILED"];

/** Campaigns list and new draft (TASK-056 over TASK-048; `MARKETING_VIEW`). */
export default function MarketingPage() {
  return (
    <Guard anyOf={["MARKETING_VIEW"]}>
      <Campaigns />
    </Guard>
  );
}

function Campaigns() {
  const { t, m, date } = useMarketingT();
  const can = useCan();
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [channel, setChannel] = useState("");
  const [creating, setCreating] = useState(false);
  const query = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
  if (status) query.set("status", status);
  if (channel) query.set("channel", channel);
  const { state, reload } = useApiData<CampaignSummaryView[]>(`/api/v1/admin/campaigns?${query}`);

  return (
    <section>
      <PageTitle
        aside={
          can("MARKETING_CREATE") && !creating ? (
            <Button onClick={() => setCreating(true)}>{m.newCampaign}</Button>
          ) : null
        }
      >
        {t.sections.marketing}
      </PageTitle>
      <p className="mb-4 max-w-2xl text-ink-soft">{m.campaignIntro}</p>
      {creating ? (
        <CampaignEditor
          onSaved={(saved) => router.push(`/staff/marketing/${saved.id}`)}
          onCancel={() => setCreating(false)}
        />
      ) : null}
      <div className="mb-4 flex flex-wrap items-end gap-3">
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
              {m.campaignStatuses[s]}
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
      </div>
      <Loaded load={state} reload={reload}>
        {(campaigns) =>
          campaigns.length === 0 ? (
            <p className="text-ink-soft">{m.empty}</p>
          ) : (
            <>
              <Table head={[m.name, m.channel, m.segment, m.status, m.createdBy, m.created]}>
                {campaigns.map((c) => (
                  <tr key={c.id}>
                    <td className="px-3 py-2">
                      <Link href={`/staff/marketing/${c.id}`} className="text-plum hover:underline">
                        {c.name}
                      </Link>
                    </td>
                    <td className="px-3 py-2">{m.channels[c.channel]}</td>
                    <td className="px-3 py-2">{m.segmentTypes[c.segment.type]}</td>
                    <td className="px-3 py-2">{m.campaignStatuses[c.status] ?? c.status}</td>
                    <td className="px-3 py-2">{c.createdBy.displayName}</td>
                    <td className="px-3 py-2 text-xs">{date(c.createdAt)}</td>
                  </tr>
                ))}
              </Table>
              <Pager page={page} count={campaigns.length} pageSize={PAGE_SIZE} onPage={setPage} />
            </>
          )
        }
      </Loaded>
    </section>
  );
}
