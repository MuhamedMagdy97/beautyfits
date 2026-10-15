"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import type { CampaignView } from "@/server/modules/marketing/campaigns-service";
import {
  Button,
  Card,
  Guard,
  Input,
  Loaded,
  PageTitle,
  useAction,
  useApiData,
  useCan,
} from "../../../_components/catalog-ui";
import { staffPost } from "../../../_lib/api";
import { useMarketingT } from "../../../_lib/marketing-i18n";
import { formatPiastres } from "../../../_lib/money";
import { useStaffSession } from "../../../_lib/session";
import { CampaignEditor } from "../editor";

/**
 * One campaign (TASK-056 over TASK-048, ADR-0061): edit while a draft,
 * submit, approve or reject (Owner/Admin, never one's own), send once
 * approved. Delivery (TASK-049) is not built: only the fixed recipient count
 * is shown after sending.
 */
export default function CampaignPage() {
  return (
    <Guard anyOf={["MARKETING_VIEW"]}>
      <Campaign />
    </Guard>
  );
}

function Campaign() {
  const { id } = useParams<{ id: string }>();
  const { state, reload } = useApiData<CampaignView>(`/api/v1/admin/campaigns/${id}`);
  return (
    <Loaded load={state} reload={reload}>
      {(campaign) => <CampaignDetail campaign={campaign} reload={reload} />}
    </Loaded>
  );
}

function CampaignDetail({ campaign, reload }: { campaign: CampaignView; reload: () => void }) {
  const { m, date } = useMarketingT();
  const can = useCan();
  const { session } = useStaffSession();
  const [editing, setEditing] = useState(false);
  const [reason, setReason] = useState("");
  const action = useAction(() => {
    setReason("");
    reload();
  });
  const { segment, status } = campaign;
  // The submitter of the pending request: the latest submission in the history.
  const submitter = campaign.history.findLast((h) => h.action === "CAMPAIGN_SUBMITTED")?.actor.id;
  const people = new Map(
    [campaign.createdBy, campaign.approvedBy, campaign.sentBy]
      .filter((p) => p !== null)
      .map((p) => [p.id, p.displayName]),
  );
  const post = (verb: string, body: unknown, done: string) =>
    void action.run(() => staffPost(`/api/v1/admin/campaigns/${campaign.id}/${verb}`, body), done);
  const reasonBody = () => (reason.trim() ? { reason: reason.trim() } : {});

  if (editing) {
    return (
      <CampaignEditor
        campaign={campaign}
        onSaved={() => {
          setEditing(false);
          reload();
        }}
        onCancel={() => setEditing(false)}
      />
    );
  }

  const audience =
    segment.type === "PRODUCT_BUYERS"
      ? `${m.products}: ${segment.productIds.length}`
      : segment.type === "BRAND_BUYERS"
        ? `${m.brands}: ${segment.brandIds.length}`
        : segment.type === "CATEGORY_BUYERS"
          ? `${m.categories}: ${segment.categoryIds.length}`
          : segment.type === "INACTIVE"
            ? `${m.inactiveDays}: ${segment.inactiveDays}`
            : segment.type === "HIGH_SPENDING"
              ? `${m.minSpent}: ${formatPiastres(segment.minSpent)}`
              : null;

  return (
    <section>
      <Link href="/staff/marketing" className="mb-3 inline-block text-sm text-plum hover:underline">
        {m.backToCampaigns}
      </Link>
      <PageTitle
        aside={
          <span className="rounded-full border border-line px-3 py-1 text-sm">
            {m.campaignStatuses[status] ?? status}
          </span>
        }
      >
        {campaign.name}
      </PageTitle>
      {status === "DRAFT" && campaign.approval?.status === "REJECTED" ? (
        <p className="mb-4 rounded-md border border-danger bg-danger-soft p-3 text-sm text-danger">
          {m.lastRejection.replace("{reason}", campaign.approval.resolutionReason ?? m.none)}
        </p>
      ) : null}
      <Card>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <Item label={m.channel}>{m.channels[campaign.channel]}</Item>
          <Item label={m.segment}>
            {m.segmentTypes[segment.type]}
            {audience ? ` · ${audience}` : ""}
          </Item>
          <Item label={m.createdBy}>
            {campaign.createdBy.displayName} · {date(campaign.createdAt)}
          </Item>
          {campaign.approvedBy ? (
            <Item label={m.approvedBy}>
              {campaign.approvedBy.displayName} · {date(campaign.approvedAt)}
            </Item>
          ) : null}
          {campaign.sentBy ? (
            <Item label={m.sentBy}>
              {campaign.sentBy.displayName} · {date(campaign.sendingStartedAt)}
            </Item>
          ) : null}
          {campaign.subject ? <Item label={m.subject}>{campaign.subject}</Item> : null}
        </dl>
        <p className="mt-4 text-sm text-ink-soft">{m.content}</p>
        <p className="mt-1 rounded-md bg-velvet-low p-3 text-sm whitespace-pre-wrap text-ink">
          {campaign.content}
        </p>
        {["SENDING", "COMPLETED", "FAILED"].includes(status) ? (
          <p className="mt-4 text-sm">
            <strong>
              {m.recipients}: {campaign.recipientCount}
            </strong>
            <br />
            <span className="text-ink-soft">{m.deliveryPending}</span>
          </p>
        ) : null}
      </Card>

      <Card>
        {action.notice}
        <div className="flex flex-wrap items-end gap-3">
          {status === "DRAFT" || status === "PENDING_APPROVAL" ? (
            <div className="min-w-48 flex-1">
              <Input
                label={m.reasonOptional}
                maxLength={1000}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </div>
          ) : null}
          {status === "DRAFT" && can("MARKETING_EDIT") ? (
            <Button variant="plain" onClick={() => setEditing(true)}>
              {m.edit}
            </Button>
          ) : null}
          {status === "DRAFT" && can("MARKETING_CREATE") ? (
            <Button
              disabled={action.pending}
              onClick={() => post("submit", reasonBody(), m.submitted)}
            >
              {m.submit}
            </Button>
          ) : null}
          {status === "PENDING_APPROVAL" && can("MARKETING_APPROVE") ? (
            submitter === session.employee.id ? (
              <p className="text-sm text-ink-soft">{m.ownSubmission}</p>
            ) : (
              <>
                <Button
                  disabled={action.pending}
                  onClick={() => post("approve", reasonBody(), m.approved)}
                >
                  {m.approve}
                </Button>
                <Button
                  variant="danger"
                  disabled={action.pending || reason.trim() === ""}
                  title={m.reasonRequired}
                  onClick={() => post("reject", { reason: reason.trim() }, m.rejected)}
                >
                  {m.reject}
                </Button>
              </>
            )
          ) : null}
          {status === "APPROVED" && can("MARKETING_SEND") ? (
            <Button
              disabled={action.pending}
              onClick={() => {
                if (window.confirm(m.sendConfirm)) post("send", undefined, m.sendingStarted);
              }}
            >
              {m.send}
            </Button>
          ) : null}
        </div>
      </Card>

      <Card title={m.history}>
        <ol className="grid gap-2 text-sm">
          {campaign.history.map((entry, index) => (
            <li key={index} className="border-b border-line pb-2 last:border-0">
              <span className="text-ink">
                {entry.status ? (m.campaignStatuses[entry.status] ?? entry.status) : entry.action}
              </span>
              <span className="text-ink-soft">
                {" "}
                · {(entry.actor.id && people.get(entry.actor.id)) ?? ""} {date(entry.createdAt)}
              </span>
              {entry.reason ? <p className="text-ink-soft">{entry.reason}</p> : null}
            </li>
          ))}
        </ol>
      </Card>
    </section>
  );
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-ink-soft">{label}</dt>
      <dd className="text-ink">{children}</dd>
    </div>
  );
}
