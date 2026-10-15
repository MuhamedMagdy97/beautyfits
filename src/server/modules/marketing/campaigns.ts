import type { CampaignStatus } from "@/generated/prisma/client";
import type { Db, TransactionClient } from "@/server/db/transaction";
import { AppError } from "@/server/errors/app-error";
import type { ApprovalHandler } from "@/server/modules/approvals/approvals";
import {
  AUDIT_ENTITY_TYPES,
  employeeActor,
  recordAudit,
  type AuditAction,
} from "@/server/modules/audit/audit";
import { conflict } from "@/server/modules/catalog/errors";

/**
 * Campaign status changes shared by the service and the `MARKETING_CAMPAIGN`
 * approval handler (TASK-048, Q13, Q139, Q142, ADR-0061).
 *
 * This file must not import approvals.ts at runtime: approvals.ts loads the
 * handlers, which load this file.
 */

/**
 * Every allowed move. TASK-048 makes the first five; TASK-049 (delivery)
 * ends SENDING in COMPLETED or FAILED through `assertTransition`.
 */
export const CAMPAIGN_TRANSITIONS: Readonly<Record<CampaignStatus, readonly CampaignStatus[]>> = {
  DRAFT: ["PENDING_APPROVAL"],
  PENDING_APPROVAL: ["APPROVED", "DRAFT"],
  APPROVED: ["SENDING"],
  SENDING: ["COMPLETED", "FAILED"],
  COMPLETED: [],
  FAILED: [],
  CANCELLED: [],
};

/** `409 CONFLICT`, reason `CAMPAIGN_STATUS_INVALID`, unless `from → to` is allowed. */
export function assertTransition(from: CampaignStatus, to: CampaignStatus): void {
  if (!CAMPAIGN_TRANSITIONS[from].includes(to)) {
    throw conflict(`A ${from} campaign cannot become ${to}.`, {
      reason: "CAMPAIGN_STATUS_INVALID",
      status: from,
    });
  }
}

/** `409 CONFLICT`, reason `CAMPAIGN_STATUS_INVALID`, unless the campaign is in `required`. */
export function assertStatus(current: CampaignStatus, required: CampaignStatus): void {
  if (current !== required) {
    throw conflict(`The campaign is ${current}, not ${required}.`, {
      reason: "CAMPAIGN_STATUS_INVALID",
      status: current,
    });
  }
}

export function campaignNotFound(): AppError {
  return new AppError("NOT_FOUND", "Campaign not found.");
}

/** Locks the campaign row and returns its status. */
export async function lockCampaign(tx: Db, campaignId: string): Promise<CampaignStatus> {
  const rows = await tx.$queryRaw<{ status: CampaignStatus }[]>`
    SELECT status FROM campaigns WHERE id = ${campaignId}::uuid FOR UPDATE`;
  if (rows.length === 0) {
    throw campaignNotFound();
  }
  return rows[0].status;
}

export interface StatusChange {
  employeeId: string;
  now: Date;
  correlationId: string | null;
  reason?: string | null;
  /** Extra audit data for the new state. */
  details?: Record<string, string | number>;
}

/** Moves the (locked) campaign from `from` to `to` and writes its audit entry. */
export async function changeStatus(
  tx: Db,
  campaignId: string,
  from: CampaignStatus,
  to: CampaignStatus,
  action: AuditAction,
  change: StatusChange,
  data: Record<string, unknown> = {},
): Promise<void> {
  assertTransition(from, to);
  await tx.campaign.update({
    where: { id: campaignId },
    data: { ...data, status: to, updatedAt: change.now },
  });
  await recordAudit(tx, {
    actor: employeeActor(change.employeeId),
    action,
    entityType: AUDIT_ENTITY_TYPES.campaign,
    entityId: campaignId,
    previous: { status: from },
    next: { status: to, ...change.details },
    reason: change.reason ?? null,
    correlationId: change.correlationId,
    createdAt: change.now,
  });
}

async function lockPending(tx: TransactionClient, campaignId: string): Promise<void> {
  assertStatus(await lockCampaign(tx, campaignId), "PENDING_APPROVAL");
}

/**
 * Approval (Owner/Admin, Q142): PENDING_APPROVAL → APPROVED. Rejection: back
 * to DRAFT so the author can fix and resubmit.
 */
export const campaignApprovalHandler: ApprovalHandler = {
  async onApproved(tx, request, context) {
    await lockPending(tx, request.entityId);
    await changeStatus(
      tx,
      request.entityId,
      "PENDING_APPROVAL",
      "APPROVED",
      "CAMPAIGN_APPROVED",
      {
        employeeId: context.resolverEmployeeId,
        now: context.now,
        correlationId: context.correlationId,
        reason: context.reason,
      },
      { approvedByEmployeeId: context.resolverEmployeeId, approvedAt: context.now },
    );
  },
  async onRejected(tx, request, context) {
    await lockPending(tx, request.entityId);
    await changeStatus(
      tx,
      request.entityId,
      "PENDING_APPROVAL",
      "DRAFT",
      "CAMPAIGN_REJECTED",
      {
        employeeId: context.resolverEmployeeId,
        now: context.now,
        correlationId: context.correlationId,
        reason: context.reason,
      },
      { submittedAt: null },
    );
  },
};
