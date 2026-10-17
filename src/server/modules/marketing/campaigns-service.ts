import type {
  CampaignStatus,
  MarketingChannel,
  Prisma,
  PrismaClient,
} from "@/generated/prisma/client";
import { getDb } from "@/server/db/client";
import { runInTransaction, type Db, type TransactionClient } from "@/server/db/transaction";
import type { Pagination } from "@/server/http/response";
import type { Logger } from "@/server/logging/logger";
import {
  findPendingApproval,
  getApprovalService,
  isSoleOwner,
  requestApproval,
} from "@/server/modules/approvals/approvals";
import { AUDIT_ENTITY_TYPES, employeeActor, recordAudit } from "@/server/modules/audit/audit";
import { conflict, validationError } from "@/server/modules/catalog/errors";
import {
  segmentCustomerIds,
  segmentDefinitionSchema,
  type SegmentDefinition,
} from "@/server/modules/customers/segments";
import {
  assertStatus,
  campaignNotFound,
  changeStatus,
  lockCampaign,
} from "@/server/modules/marketing/campaigns";
import type {
  CreateCampaignInput,
  ListCampaignsQuery,
  UpdateCampaignInput,
} from "@/server/modules/marketing/schemas";
import { systemClock, type Clock } from "@/server/time/time";

/**
 * Marketing campaigns (TASK-048, Business Spec Q13, Q139, Q140, Q142; User
 * Flows §16.4; Architecture §17; API §24; ADR-0061).
 *
 * DRAFT → PENDING_APPROVAL → APPROVED → SENDING; TASK-049 ends SENDING in
 * COMPLETED or FAILED.
 * - Marketing staff draft and submit; submitting opens a `MARKETING_CAMPAIGN`
 *   approval request. Only an Owner/Admin approves (Q142), never the person
 *   who submitted it (approval requests, ADR-0018). A rejection returns the
 *   campaign to DRAFT with the reason.
 * - Only drafts are edited, so what was approved is what is sent.
 * - "Send" (Q13: never automatic) fixes the recipients: the segment's
 *   customers opted in to the channel at that moment, as PENDING
 *   `campaign_recipients`. Nothing is sent here; TASK-049 delivers them with
 *   frequency limits, retries and fallback.
 */

export interface CampaignActor {
  employeeId: string;
}

interface Ctx {
  logger: Logger;
  correlationId: string | null;
}

interface PersonRef {
  id: string;
  displayName: string;
}

export interface CampaignSummaryView {
  id: string;
  name: string;
  channel: MarketingChannel;
  status: CampaignStatus;
  segment: SegmentDefinition;
  subject: string | null;
  content: string;
  createdBy: PersonRef;
  submittedAt: string | null;
  approvedBy: PersonRef | null;
  approvedAt: string | null;
  sentBy: PersonRef | null;
  sendingStartedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CampaignView extends CampaignSummaryView {
  /** Fixed when sending starts; 0 before. */
  recipientCount: number;
  /** The latest approval request: shows a rejection reason to the author. */
  approval: {
    id: string;
    status: string;
    resolutionReason: string | null;
    resolvedAt: string | null;
  } | null;
  /** The campaign's audit entries, oldest first. */
  history: {
    action: string;
    actor: { type: string; id: string | null };
    previousStatus: string | null;
    status: string | null;
    reason: string | null;
    createdAt: string;
  }[];
}

const person = { select: { id: true, displayName: true } } as const;
const summaryInclude = {
  createdBy: person,
  approvedBy: person,
  sentBy: person,
} as const satisfies Prisma.CampaignInclude;

type SummaryRow = Prisma.CampaignGetPayload<{ include: typeof summaryInclude }>;

function iso(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

function toSummary(row: SummaryRow): CampaignSummaryView {
  return {
    id: row.id,
    name: row.name,
    channel: row.channel,
    status: row.status,
    segment: segmentDefinitionSchema.parse(row.segment),
    subject: row.subject,
    content: row.content,
    createdBy: row.createdBy,
    submittedAt: iso(row.submittedAt),
    approvedBy: row.approvedBy,
    approvedAt: iso(row.approvedAt),
    sentBy: row.sentBy,
    sendingStartedAt: iso(row.sendingStartedAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function statusOf(data: unknown): string | null {
  const status = (data as { status?: unknown } | null)?.status;
  return typeof status === "string" ? status : null;
}

async function loadView(db: Db, campaignId: string): Promise<CampaignView> {
  const row = await db.campaign.findUnique({ where: { id: campaignId }, include: summaryInclude });
  if (!row) {
    throw campaignNotFound();
  }
  const [recipientCount, approval, audits] = await Promise.all([
    db.campaignRecipient.count({ where: { campaignId } }),
    db.approvalRequest.findFirst({
      where: {
        approvalType: "MARKETING_CAMPAIGN",
        entityType: AUDIT_ENTITY_TYPES.campaign,
        entityId: campaignId,
      },
      orderBy: [{ requestedAt: "desc" }, { id: "desc" }],
    }),
    db.auditLog.findMany({
      where: { entityType: AUDIT_ENTITY_TYPES.campaign, entityId: campaignId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
  ]);
  return {
    ...toSummary(row),
    recipientCount,
    approval: approval && {
      id: approval.id,
      status: approval.status,
      resolutionReason: approval.resolutionReason,
      resolvedAt: iso(approval.resolvedAt),
    },
    history: audits.map((entry) => ({
      action: entry.action,
      actor: { type: entry.actorType, id: entry.actorId },
      previousStatus: statusOf(entry.previousDataJson),
      status: statusOf(entry.newDataJson),
      reason: entry.reason,
      createdAt: entry.createdAt.toISOString(),
    })),
  };
}

/** An email needs a subject; WhatsApp has none. */
function checkSubject(channel: MarketingChannel, subject: string | null): void {
  if (channel === "EMAIL" && subject === null) {
    throw validationError("subject", "subject_required", "An email campaign needs a subject.");
  }
  if (channel === "WHATSAPP" && subject !== null) {
    throw validationError("subject", "subject_not_allowed", "A WhatsApp campaign has no subject.");
  }
}

function snapshot(fields: {
  name: string;
  segment: SegmentDefinition;
  subject: string | null;
  content: string;
}) {
  return {
    name: fields.name,
    channel: fields.segment.channel,
    segment: fields.segment,
    subject: fields.subject,
    content: fields.content,
  };
}

export function createCampaignsService(deps: { db: PrismaClient; clock: Clock }) {
  const { db, clock } = deps;

  function inTx<T>(work: (tx: TransactionClient) => Promise<T>): Promise<T> {
    return runInTransaction(work, {}, db);
  }

  /** `POST /admin/campaigns` (`MARKETING_CREATE`): a DRAFT. */
  async function createCampaign(
    actor: CampaignActor,
    input: CreateCampaignInput,
    ctx: Ctx,
  ): Promise<CampaignView> {
    const subject = input.subject ?? null;
    checkSubject(input.segment.channel, subject);
    const now = clock.now();
    const view = await inTx(async (tx) => {
      const created = await tx.campaign.create({
        data: {
          name: input.name,
          channel: input.segment.channel,
          segment: input.segment,
          subject,
          content: input.content,
          createdByEmployeeId: actor.employeeId,
          createdAt: now,
          updatedAt: now,
        },
      });
      await recordAudit(tx, {
        actor: employeeActor(actor.employeeId),
        action: "CAMPAIGN_CREATED",
        entityType: AUDIT_ENTITY_TYPES.campaign,
        entityId: created.id,
        next: { ...snapshot({ ...input, subject }), status: "DRAFT" },
        correlationId: ctx.correlationId,
        createdAt: now,
      });
      return loadView(tx, created.id);
    });
    ctx.logger.info("campaign created", { campaignId: view.id, actorEmployeeId: actor.employeeId });
    return view;
  }

  /** `PATCH /admin/campaigns/{id}` (`MARKETING_EDIT`): drafts only. */
  async function updateCampaign(
    actor: CampaignActor,
    campaignId: string,
    input: UpdateCampaignInput,
    ctx: Ctx,
  ): Promise<CampaignView> {
    const now = clock.now();
    return inTx(async (tx) => {
      assertStatus(await lockCampaign(tx, campaignId), "DRAFT");
      const row = await tx.campaign.findUniqueOrThrow({ where: { id: campaignId } });
      const current = {
        name: row.name,
        segment: segmentDefinitionSchema.parse(row.segment),
        subject: row.subject,
        content: row.content,
      };
      const next = {
        name: input.name ?? current.name,
        segment: input.segment ?? current.segment,
        subject: input.subject === undefined ? current.subject : input.subject,
        content: input.content ?? current.content,
      };
      checkSubject(next.segment.channel, next.subject);
      const previous = snapshot(current);
      const changed = snapshot(next);
      if (JSON.stringify(previous) !== JSON.stringify(changed)) {
        await tx.campaign.update({
          where: { id: campaignId },
          data: { ...next, channel: next.segment.channel, updatedAt: now },
        });
        await recordAudit(tx, {
          actor: employeeActor(actor.employeeId),
          action: "CAMPAIGN_UPDATED",
          entityType: AUDIT_ENTITY_TYPES.campaign,
          entityId: campaignId,
          previous,
          next: changed,
          correlationId: ctx.correlationId,
          createdAt: now,
        });
      }
      return loadView(tx, campaignId);
    });
  }

  /**
   * `POST /admin/campaigns/{id}/submit` (`MARKETING_CREATE`): DRAFT →
   * PENDING_APPROVAL with a `MARKETING_CAMPAIGN` approval request. The
   * request records the audience size at submission for the approver.
   */
  async function submitCampaign(
    actor: CampaignActor,
    campaignId: string,
    input: { reason?: string },
    ctx: Ctx,
  ): Promise<CampaignView> {
    const now = clock.now();
    return inTx(async (tx) => {
      assertStatus(await lockCampaign(tx, campaignId), "DRAFT");
      const row = await tx.campaign.findUniqueOrThrow({ where: { id: campaignId } });
      const segment = segmentDefinitionSchema.parse(row.segment);
      // ponytail: loads the ids to count them, as the segment preview does.
      const audienceCount = (await segmentCustomerIds(tx, segment, now)).length;
      await changeStatus(
        tx,
        campaignId,
        "DRAFT",
        "PENDING_APPROVAL",
        "CAMPAIGN_SUBMITTED",
        {
          employeeId: actor.employeeId,
          now,
          correlationId: ctx.correlationId,
          reason: input.reason,
          details: { audienceCount },
        },
        { submittedAt: now },
      );
      if (await isSoleOwner(tx, actor.employeeId)) {
        // BD-049 (owner decision 2026-10-18): nobody else could approve, so a
        // sole Owner's campaign is approved on submit, as purchase orders are.
        await changeStatus(
          tx,
          campaignId,
          "PENDING_APPROVAL",
          "APPROVED",
          "CAMPAIGN_APPROVED",
          {
            employeeId: actor.employeeId,
            now,
            correlationId: ctx.correlationId,
            reason: "Approved on submit (sole Owner).",
          },
          { approvedByEmployeeId: actor.employeeId, approvedAt: now },
        );
        return loadView(tx, campaignId);
      }
      await requestApproval(
        tx,
        {
          approvalType: "MARKETING_CAMPAIGN",
          entityType: AUDIT_ENTITY_TYPES.campaign,
          entityId: campaignId,
          requestedByEmployeeId: actor.employeeId,
          reason: input.reason ?? null,
          metadata: { name: row.name, channel: row.channel, segment, audienceCount },
        },
        { now, correlationId: ctx.correlationId },
      );
      return loadView(tx, campaignId);
    });
  }

  /** Resolves the campaign's pending approval request (`MARKETING_APPROVE`). */
  async function resolveCampaign(
    outcome: "approve" | "reject",
    actor: CampaignActor,
    campaignId: string,
    input: { reason?: string },
    ctx: Ctx,
  ): Promise<CampaignView> {
    const pending = await findPendingApproval(
      db,
      "MARKETING_CAMPAIGN",
      AUDIT_ENTITY_TYPES.campaign,
      campaignId,
    );
    if (!pending) {
      const row = await db.campaign.findUnique({
        where: { id: campaignId },
        select: { status: true },
      });
      if (!row) {
        throw campaignNotFound();
      }
      throw conflict("This campaign has no pending approval request.", {
        reason: "CAMPAIGN_STATUS_INVALID",
        status: row.status,
      });
    }
    const approvals = getApprovalService();
    if (outcome === "approve") {
      await approvals.approve(actor.employeeId, pending.id, input, ctx.correlationId);
    } else {
      await approvals.reject(
        actor.employeeId,
        pending.id,
        { reason: input.reason! },
        ctx.correlationId,
      );
    }
    return loadView(db, campaignId);
  }

  /**
   * `POST /admin/campaigns/{id}/send` (`MARKETING_SEND`): APPROVED → SENDING.
   * Fixes the recipients (opted in to the channel now, Q140) as PENDING rows
   * for TASK-049. An empty audience is refused and the campaign stays
   * APPROVED.
   */
  async function sendCampaign(
    actor: CampaignActor,
    campaignId: string,
    ctx: Ctx,
  ): Promise<CampaignView> {
    const now = clock.now();
    const view = await inTx(async (tx) => {
      assertStatus(await lockCampaign(tx, campaignId), "APPROVED");
      const row = await tx.campaign.findUniqueOrThrow({ where: { id: campaignId } });
      const segment = segmentDefinitionSchema.parse(row.segment);
      const customerIds = await segmentCustomerIds(tx, segment, now);
      if (customerIds.length === 0) {
        throw conflict("No customer in the segment is opted in to the channel.", {
          reason: "CAMPAIGN_AUDIENCE_EMPTY",
        });
      }
      // The consent row that made each customer eligible.
      const consents = await tx.$queryRaw<{ customer_id: string; id: bigint }[]>`
        SELECT DISTINCT ON (customer_id) customer_id::text AS customer_id, id
        FROM marketing_consents
        WHERE channel = ${segment.channel}::marketing_channel
          AND customer_id = ANY(${customerIds}::uuid[])
        ORDER BY customer_id, id DESC`;
      const consentOf = new Map(consents.map((c) => [c.customer_id, c.id.toString()]));
      await tx.campaignRecipient.createMany({
        data: customerIds.map((customerId) => ({
          campaignId,
          customerId,
          channel: segment.channel,
          eligibilitySnapshot: {
            segmentType: segment.type,
            consentId: consentOf.get(customerId) ?? null,
          },
          createdAt: now,
        })),
      });
      await changeStatus(
        tx,
        campaignId,
        "APPROVED",
        "SENDING",
        "CAMPAIGN_SENDING_STARTED",
        {
          employeeId: actor.employeeId,
          now,
          correlationId: ctx.correlationId,
          details: { recipientCount: customerIds.length },
        },
        { sentByEmployeeId: actor.employeeId, sendingStartedAt: now },
      );
      return loadView(tx, campaignId);
    });
    ctx.logger.info("campaign sending started", {
      campaignId,
      recipientCount: view.recipientCount,
      actorEmployeeId: actor.employeeId,
    });
    return view;
  }

  function getCampaign(campaignId: string): Promise<CampaignView> {
    return loadView(db, campaignId);
  }

  async function listCampaigns(
    query: ListCampaignsQuery,
  ): Promise<{ items: CampaignSummaryView[]; pagination: Pagination }> {
    const where: Prisma.CampaignWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.channel ? { channel: query.channel } : {}),
    };
    const [total, rows] = await Promise.all([
      db.campaign.count({ where }),
      db.campaign.findMany({
        where,
        include: summaryInclude,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return {
      items: rows.map(toSummary),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.ceil(total / query.pageSize),
      },
    };
  }

  return {
    createCampaign,
    updateCampaign,
    submitCampaign,
    approveCampaign: (a: CampaignActor, id: string, input: { reason?: string }, ctx: Ctx) =>
      resolveCampaign("approve", a, id, input, ctx),
    rejectCampaign: (a: CampaignActor, id: string, input: { reason: string }, ctx: Ctx) =>
      resolveCampaign("reject", a, id, input, ctx),
    sendCampaign,
    getCampaign,
    listCampaigns,
  };
}

export type CampaignsService = ReturnType<typeof createCampaignsService>;

let defaultService: CampaignsService | undefined;

export function getCampaignsService(): CampaignsService {
  defaultService ??= createCampaignsService({ db: getDb(), clock: systemClock });
  return defaultService;
}
