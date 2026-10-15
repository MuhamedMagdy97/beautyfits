import { describe, expect, it } from "vitest";
import { assertTransition, CAMPAIGN_TRANSITIONS } from "@/server/modules/marketing/campaigns";
import {
  campaignStatusSchema,
  createCampaignSchema,
  updateCampaignSchema,
} from "@/server/modules/marketing/schemas";

/** Campaign lifecycle and request schemas (TASK-048, ADR-0061). */

describe("campaign transitions", () => {
  it("cover every status", () => {
    expect(Object.keys(CAMPAIGN_TRANSITIONS).sort()).toEqual(
      [...campaignStatusSchema.options].sort(),
    );
  });

  it("allow only the documented lifecycle", () => {
    expect(() => assertTransition("DRAFT", "PENDING_APPROVAL")).not.toThrow();
    expect(() => assertTransition("PENDING_APPROVAL", "APPROVED")).not.toThrow();
    expect(() => assertTransition("PENDING_APPROVAL", "DRAFT")).not.toThrow();
    expect(() => assertTransition("APPROVED", "SENDING")).not.toThrow();
    expect(() => assertTransition("SENDING", "COMPLETED")).not.toThrow();
    expect(() => assertTransition("SENDING", "FAILED")).not.toThrow();
    for (const [from, to] of [
      ["DRAFT", "APPROVED"],
      ["DRAFT", "SENDING"],
      ["PENDING_APPROVAL", "SENDING"],
      ["APPROVED", "DRAFT"],
      ["COMPLETED", "SENDING"],
      ["FAILED", "SENDING"],
    ] as const) {
      expect(() => assertTransition(from, to)).toThrow(
        expect.objectContaining({ details: { reason: "CAMPAIGN_STATUS_INVALID", status: from } }),
      );
    }
  });
});

describe("campaign schemas", () => {
  const segment = { type: "ALL_OPTED_IN", channel: "EMAIL" };

  it("needs a name, a valid segment and content", () => {
    expect(
      createCampaignSchema.parse({ name: " Eid ", segment, subject: "Hi", content: " Sale " }),
    ).toEqual({ name: "Eid", segment, subject: "Hi", content: "Sale" });
    expect(createCampaignSchema.safeParse({ name: "x", segment, content: " " }).success).toBe(
      false,
    );
    expect(
      createCampaignSchema.safeParse({
        name: "x",
        segment: { type: "INACTIVE", channel: "EMAIL" },
        content: "y",
      }).success,
    ).toBe(false);
    expect(
      createCampaignSchema.safeParse({ name: "x", segment, content: "y".repeat(10_001) }).success,
    ).toBe(false);
  });

  it("needs at least one field to update", () => {
    expect(updateCampaignSchema.safeParse({}).success).toBe(false);
    expect(updateCampaignSchema.parse({ subject: null })).toEqual({ subject: null });
  });
});
