import type { ApprovalHandlers } from "@/server/modules/approvals/approvals";
import { overDeliveryApprovalHandler } from "@/server/modules/purchasing/goods-receipts";
import { purchaseOrderApprovalHandler } from "@/server/modules/purchasing/purchase-orders";
import { supplierReturnApprovalHandler } from "@/server/modules/purchasing/supplier-returns";
import { criticalSettingApprovalHandler } from "@/server/modules/settings/settings-service";

/**
 * What happens when each type of approval request is approved or rejected
 * (ADR-0018). Each feature adds its handler here when it starts creating
 * requests of its type (Business Spec R19):
 *
 * - `PURCHASE_ORDER`: TASK-022 (purchase orders)
 * - `PURCHASE_OVER_DELIVERY`: TASK-023 (goods receiving, Q116)
 * - `SUPPLIER_RETURN`: TASK-024 (supplier returns, Q105)
 * - `MARKETING_CAMPAIGN`: TASK-048 (campaigns, Q142)
 * - `CRITICAL_SETTING`: TASK-057 (settings, Q180)
 *
 * Approving a request whose type has no handler fails, so a request can only
 * be approved once its feature knows how to apply it.
 */
// Getters: the feature modules import `approvals.ts`, which imports this file, so
// reading their handlers while this module is evaluated can hit a binding that is
// not initialized yet (import cycle; seen in the production build). Read on use.
export const APPROVAL_HANDLERS: ApprovalHandlers = {
  get PURCHASE_ORDER() {
    return purchaseOrderApprovalHandler;
  },
  get PURCHASE_OVER_DELIVERY() {
    return overDeliveryApprovalHandler;
  },
  get SUPPLIER_RETURN() {
    return supplierReturnApprovalHandler;
  },
  get CRITICAL_SETTING() {
    return criticalSettingApprovalHandler;
  },
};
