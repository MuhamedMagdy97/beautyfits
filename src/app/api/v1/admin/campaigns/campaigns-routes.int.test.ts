import { beforeEach, describe, expect, it } from "vitest";
import { POST as approveRequest } from "@/app/api/v1/admin/approval-requests/[id]/approve/route";
import { GET as getOne, PATCH as patch } from "@/app/api/v1/admin/campaigns/[id]/route";
import { POST as approve } from "@/app/api/v1/admin/campaigns/[id]/approve/route";
import { POST as reject } from "@/app/api/v1/admin/campaigns/[id]/reject/route";
import { POST as send } from "@/app/api/v1/admin/campaigns/[id]/send/route";
import { POST as submit } from "@/app/api/v1/admin/campaigns/[id]/submit/route";
import { GET as list, POST as create } from "@/app/api/v1/admin/campaigns/route";
import type { EmployeeLevel, MarketingChannel } from "@/generated/prisma/client";
import { getDb } from "@/server/db/client";
import { createSession } from "@/server/modules/auth/sessions";
import type { PermissionCode } from "@/server/modules/rbac/catalog";
import { MS_PER_HOUR } from "@/server/time/time";
import { resetDatabase } from "@/test/integration/database";

/** Campaign authoring and approval (TASK-048, Q13, Q139, Q142, ADR-0061). */

const db = getDb();
const BASE = "http://localhost/api/v1/admin/campaigns";

type Handler = (request: Request, context: { params: Promise<never> }) => Promise<Response>;

async function call(
  handler: unknown,
  method: string,
  url: string,
  options: { token?: string; body?: unknown; id?: string; status?: number } = {},
) {
  const headers = new Headers({ "accept-language": "en", "content-type": "application/json" });
  if (options.token) headers.set("authorization", `Bearer ${options.token}`);
  const res = await (handler as Handler)(
    new Request(url, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    }),
    { params: Promise.resolve(options.id ? { id: options.id } : {}) as Promise<never> },
  );
  const json = await res.json();
  expect(res.status, JSON.stringify(json)).toBe(options.status ?? 200);
  return json;
}

let counter = 0;

async function staff(codes: PermissionCode[], level: EmployeeLevel = "EMPLOYEE") {
  counter += 1;
  const permissions = await db.permission.findMany({ where: { code: { in: codes } } });
  const account = await db.account.create({
    data: {
      accountType: "EMPLOYEE",
      email: `staff${counter}@beautyfits.example`,
      emailVerifiedAt: new Date(),
      passwordHash: "unused",
      status: "ACTIVE",
      employee: {
        create: {
          displayName: `Staff ${counter}`,
          employeeLevel: level,
          roles: {
            create: [
              {
                role: {
                  create: {
                    name: `Role ${counter}`,
                    permissions: { create: permissions.map((p) => ({ permissionId: p.id })) },
                  },
                },
              },
            ],
          },
        },
      },
    },
  });
  const session = await createSession(
    db,
    { accountId: account.id, domain: "EMPLOYEE", ttlMs: 12 * MS_PER_HOUR },
    { ip: null, userAgent: null },
    new Date(),
  );
  return session.tokens.accessToken;
}

async function customer(consents: [MarketingChannel, boolean][]) {
  counter += 1;
  const created = await db.customer.create({
    data: { phone: `+20101000${String(counter).padStart(4, "0")}`, fullName: `C ${counter}` },
  });
  for (const [channel, optedIn] of consents) {
    await db.marketingConsent.create({
      data: {
        customerId: created.id,
        channel,
        status: optedIn ? "OPTED_IN" : "OPTED_OUT",
        source: "CUSTOMER_ACCOUNT",
        occurredAt: new Date(),
      },
    });
  }
  return created.id;
}

const emailDraft = {
  name: "Eid sale",
  segment: { type: "ALL_OPTED_IN", channel: "EMAIL" },
  subject: "Eid sale",
  content: "20% off everything.",
};

let marketer: string;
let owner: string;
let admin: string;

beforeEach(async () => {
  await resetDatabase();
  marketer = await staff(
    ["MARKETING_VIEW", "MARKETING_CREATE", "MARKETING_EDIT", "MARKETING_SEND"],
    "MANAGER",
  );
  owner = await staff([], "OWNER");
  admin = await staff([], "ADMIN");
});

async function draft(body: unknown = emailDraft) {
  return (await call(create, "POST", BASE, { token: marketer, body, status: 201 })).data;
}

const at = (id: string, action = "") => `${BASE}/${id}${action}`;

describe("authoring", () => {
  it("creates and edits a draft, auditing both", async () => {
    const created = await draft();
    expect(created).toMatchObject({
      status: "DRAFT",
      channel: "EMAIL",
      segment: emailDraft.segment,
      subject: "Eid sale",
      recipientCount: 0,
      approval: null,
    });
    const edited = await call(patch, "PATCH", at(created.id), {
      token: marketer,
      id: created.id,
      body: { segment: { type: "ALL_OPTED_IN", channel: "WHATSAPP" }, subject: null },
    });
    expect(edited.data).toMatchObject({ channel: "WHATSAPP", subject: null });
    expect(edited.data.history.map((h: { action: string }) => h.action)).toEqual([
      "CAMPAIGN_CREATED",
      "CAMPAIGN_UPDATED",
    ]);
    const listed = await call(list, "GET", `${BASE}?channel=WHATSAPP`, { token: marketer });
    expect(listed.data.map((c: { id: string }) => c.id)).toEqual([created.id]);
    expect(listed.meta.pagination.total).toBe(1);
  });

  it("checks the subject against the channel", async () => {
    const noSubject = await call(create, "POST", BASE, {
      token: marketer,
      body: { ...emailDraft, subject: undefined },
      status: 400,
    });
    expect(noSubject.error.code).toBe("VALIDATION_ERROR");
    await call(create, "POST", BASE, {
      token: marketer,
      body: { ...emailDraft, segment: { type: "ALL_OPTED_IN", channel: "WHATSAPP" } },
      status: 400,
    });
    const created = await draft();
    await call(patch, "PATCH", at(created.id), {
      token: marketer,
      id: created.id,
      body: { segment: { type: "ALL_OPTED_IN", channel: "WHATSAPP" } },
      status: 400,
    });
  });

  it("enforces permissions", async () => {
    await call(list, "GET", BASE, { status: 401 });
    const viewer = await staff(["MARKETING_VIEW"]);
    await call(create, "POST", BASE, { token: viewer, body: emailDraft, status: 403 });
    const created = await draft();
    await call(patch, "PATCH", at(created.id), {
      token: viewer,
      id: created.id,
      body: { name: "x" },
      status: 403,
    });
    await call(submit, "POST", at(created.id, "/submit"), {
      token: viewer,
      id: created.id,
      status: 403,
    });
    // MARKETING_APPROVE is Owner/Admin only, even when a role grants it.
    const manager = await staff(["MARKETING_APPROVE", "MARKETING_CREATE"], "MANAGER");
    await call(submit, "POST", at(created.id, "/submit"), { token: marketer, id: created.id });
    const denied = await call(approve, "POST", at(created.id, "/approve"), {
      token: manager,
      id: created.id,
      status: 403,
    });
    expect(denied.error.code).toBe("PERMISSION_DENIED");
    await call(send, "POST", at(created.id, "/send"), {
      token: viewer,
      id: created.id,
      status: 403,
    });
    await call(getOne, "GET", at("not-a-uuid"), { token: viewer, id: "not-a-uuid", status: 404 });
  });
});

describe("approval", () => {
  it("submits, approves (not by the submitter) and starts sending to opted-in customers", async () => {
    const optedIn = await customer([["EMAIL", true]]);
    await customer([
      ["EMAIL", true],
      ["EMAIL", false],
    ]);
    await customer([["WHATSAPP", true]]);
    const created = await draft();

    const submitted = await call(submit, "POST", at(created.id, "/submit"), {
      token: marketer,
      id: created.id,
      body: { reason: "For Eid" },
    });
    expect(submitted.data).toMatchObject({ status: "PENDING_APPROVAL" });
    expect(submitted.data.approval.status).toBe("PENDING");
    const request = await db.approvalRequest.findFirstOrThrow({ where: { entityId: created.id } });
    expect(request).toMatchObject({ approvalType: "MARKETING_CAMPAIGN", entityType: "CAMPAIGN" });
    expect(request.metadataJson).toMatchObject({ audienceCount: 1, channel: "EMAIL" });

    // No edits or sending while pending.
    const edit = await call(patch, "PATCH", at(created.id), {
      token: marketer,
      id: created.id,
      body: { name: "x" },
      status: 409,
    });
    expect(edit.error.details).toEqual({
      reason: "CAMPAIGN_STATUS_INVALID",
      status: "PENDING_APPROVAL",
    });
    await call(send, "POST", at(created.id, "/send"), {
      token: marketer,
      id: created.id,
      status: 409,
    });

    const approved = await call(approve, "POST", at(created.id, "/approve"), {
      token: owner,
      id: created.id,
      body: { reason: "Looks good" },
    });
    expect(approved.data).toMatchObject({ status: "APPROVED", approval: { status: "APPROVED" } });
    expect(approved.data.approvedBy.displayName).toMatch(/^Staff/);
    await call(approve, "POST", at(created.id, "/approve"), {
      token: admin,
      id: created.id,
      status: 409,
    });

    const sending = await call(send, "POST", at(created.id, "/send"), {
      token: marketer,
      id: created.id,
    });
    expect(sending.data).toMatchObject({ status: "SENDING", recipientCount: 1 });
    expect(sending.data.history.map((h: { status: string }) => h.status)).toEqual([
      "DRAFT",
      "PENDING_APPROVAL",
      "APPROVED",
      "SENDING",
    ]);
    const recipients = await db.campaignRecipient.findMany({ where: { campaignId: created.id } });
    expect(recipients).toHaveLength(1);
    expect(recipients[0]).toMatchObject({
      customerId: optedIn,
      channel: "EMAIL",
      status: "PENDING",
      sentAt: null,
    });
    expect(recipients[0].eligibilitySnapshot).toMatchObject({ segmentType: "ALL_OPTED_IN" });
    await call(send, "POST", at(created.id, "/send"), {
      token: marketer,
      id: created.id,
      status: 409,
    });
  });

  it("refuses self-approval and rejects back to draft with the reason", async () => {
    const created = (
      await call(create, "POST", BASE, { token: owner, body: emailDraft, status: 201 })
    ).data;
    await call(submit, "POST", at(created.id, "/submit"), { token: owner, id: created.id });
    const self = await call(approve, "POST", at(created.id, "/approve"), {
      token: owner,
      id: created.id,
      status: 403,
    });
    expect(self.error.details.reason).toBe("SELF_APPROVAL");

    await call(reject, "POST", at(created.id, "/reject"), {
      token: admin,
      id: created.id,
      body: {},
      status: 400,
    });
    const rejected = await call(reject, "POST", at(created.id, "/reject"), {
      token: admin,
      id: created.id,
      body: { reason: "Wrong audience" },
    });
    expect(rejected.data).toMatchObject({
      status: "DRAFT",
      submittedAt: null,
      approval: { status: "REJECTED", resolutionReason: "Wrong audience" },
    });
    // Editable again and resubmittable.
    await call(patch, "PATCH", at(created.id), {
      token: owner,
      id: created.id,
      body: { name: "Eid sale v2" },
    });
    await call(submit, "POST", at(created.id, "/submit"), { token: owner, id: created.id });
  });

  it("approves a sole Owner's campaign on submit; a manager's still waits (BD-049)", async () => {
    await db.employee.updateMany({
      where: { employeeLevel: "ADMIN" },
      data: { status: "DEACTIVATED" },
    });
    const created = (
      await call(create, "POST", BASE, { token: owner, body: emailDraft, status: 201 })
    ).data;
    const submitted = await call(submit, "POST", at(created.id, "/submit"), {
      token: owner,
      id: created.id,
    });
    expect(submitted.data).toMatchObject({ status: "APPROVED" });
    expect(submitted.data.approvedAt).not.toBeNull();
    expect(await db.approvalRequest.count({ where: { entityId: created.id } })).toBe(0);
    expect(
      await db.auditLog.count({ where: { entityId: created.id, action: "CAMPAIGN_APPROVED" } }),
    ).toBe(1);

    // Only the sole Owner is exempt: a manager's campaign still needs approval.
    const other = await draft();
    const pending = await call(submit, "POST", at(other.id, "/submit"), {
      token: marketer,
      id: other.id,
    });
    expect(pending.data).toMatchObject({ status: "PENDING_APPROVAL" });
  });

  it("gives the same outcome through the approval queue", async () => {
    const created = await draft();
    await call(submit, "POST", at(created.id, "/submit"), { token: marketer, id: created.id });
    const request = await db.approvalRequest.findFirstOrThrow({ where: { entityId: created.id } });
    await call(
      approveRequest,
      "POST",
      `http://localhost/api/v1/admin/approval-requests/${request.id}/approve`,
      {
        token: admin,
        id: request.id,
        body: {},
      },
    );
    const campaign = await call(getOne, "GET", at(created.id), { token: marketer, id: created.id });
    expect(campaign.data).toMatchObject({ status: "APPROVED" });
  });

  it("refuses approving a draft and sending to an empty audience", async () => {
    const created = await draft();
    const early = await call(approve, "POST", at(created.id, "/approve"), {
      token: owner,
      id: created.id,
      status: 409,
    });
    expect(early.error.details).toEqual({ reason: "CAMPAIGN_STATUS_INVALID", status: "DRAFT" });
    await call(submit, "POST", at(created.id, "/submit"), { token: marketer, id: created.id });
    await call(approve, "POST", at(created.id, "/approve"), { token: owner, id: created.id });
    const empty = await call(send, "POST", at(created.id, "/send"), {
      token: marketer,
      id: created.id,
      status: 409,
    });
    expect(empty.error.details.reason).toBe("CAMPAIGN_AUDIENCE_EMPTY");
    const still = await call(getOne, "GET", at(created.id), { token: marketer, id: created.id });
    expect(still.data.status).toBe("APPROVED");
  });

  it("never deletes campaigns", async () => {
    const created = await draft();
    await expect(db.campaign.delete({ where: { id: created.id } })).rejects.toThrow();
  });
});
