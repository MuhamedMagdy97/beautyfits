import { describe, expect, it } from "vitest";
import {
  approveApprovalRequestSchema,
  approvalTypeSchema,
  listApprovalRequestsQuerySchema,
  rejectApprovalRequestSchema,
} from "@/server/modules/approvals/schemas";
import { AUDIT_ACTIONS } from "@/server/modules/audit/audit";
import { listAuditLogsQuerySchema } from "@/server/modules/audit/schemas";

/** Audit log and approval request schemas (TASK-013). */

describe("audit actions", () => {
  it("are unique upper-case codes", () => {
    expect(new Set(AUDIT_ACTIONS).size).toBe(AUDIT_ACTIONS.length);
    for (const action of AUDIT_ACTIONS) {
      expect(action).toMatch(/^[A-Z][A-Z_]*$/);
    }
  });
});

describe("listAuditLogsQuerySchema", () => {
  it("parses filters and dates", () => {
    const parsed = listAuditLogsQuerySchema.parse({
      actorType: "EMPLOYEE",
      from: "2026-10-01T00:00:00+03:00",
      to: "2026-10-02T00:00:00Z",
    });
    expect(parsed).toMatchObject({ page: 1, pageSize: 24, actorType: "EMPLOYEE" });
    expect(parsed.from?.toISOString()).toBe("2026-09-30T21:00:00.000Z");
  });

  it("rejects an empty or reversed time window and bad values", () => {
    const at = "2026-10-01T00:00:00Z";
    expect(listAuditLogsQuerySchema.safeParse({ from: at, to: at }).success).toBe(false);
    expect(listAuditLogsQuerySchema.safeParse({ from: "2026-10-01" }).success).toBe(false);
    expect(listAuditLogsQuerySchema.safeParse({ actorId: "x" }).success).toBe(false);
  });
});

describe("approval request schemas", () => {
  it("lists exactly the R19 approval types (plus supplier returns, ADR-0029)", () => {
    expect(approvalTypeSchema.options).toEqual([
      "PURCHASE_ORDER",
      "PURCHASE_OVER_DELIVERY",
      "SUPPLIER_RETURN",
      "MARKETING_CAMPAIGN",
      "CRITICAL_SETTING",
    ]);
    expect(listApprovalRequestsQuerySchema.safeParse({ status: "OPEN" }).success).toBe(false);
  });

  it("makes the approval reason optional and the rejection reason required", () => {
    expect(approveApprovalRequestSchema.parse({})).toEqual({});
    expect(approveApprovalRequestSchema.parse({ reason: "  " })).toEqual({ reason: null });
    expect(rejectApprovalRequestSchema.safeParse({}).success).toBe(false);
    expect(rejectApprovalRequestSchema.safeParse({ reason: "   " }).success).toBe(false);
    expect(rejectApprovalRequestSchema.parse({ reason: " Too long " })).toEqual({
      reason: "Too long",
    });
  });
});
