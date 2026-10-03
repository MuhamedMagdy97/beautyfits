import type { ApprovalHandlers } from "@/server/modules/approvals/approvals";
import { purchaseOrderApprovalHandler } from "@/server/modules/purchasing/purchase-orders";

/**
 * What happens when each type of approval request is approved or rejected
 * (ADR-0018). Each feature adds its handler here when it starts creating
 * requests of its type (Business Spec R19):
 *
 * - `PURCHASE_ORDER`: TASK-022 (purchase orders)
 * - `PURCHASE_OVER_DELIVERY`: TASK-023 (goods receiving, Q116)
 * - `MARKETING_CAMPAIGN`: TASK-048 (campaigns, Q142)
 * - `CRITICAL_SETTING`: TASK-057 (settings, Q180)
 *
 * Approving a request whose type has no handler fails, so a request can only
 * be approved once its feature knows how to apply it.
 */
export const APPROVAL_HANDLERS: ApprovalHandlers = {
  PURCHASE_ORDER: purchaseOrderApprovalHandler,
};
