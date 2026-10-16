import { beforeEach, describe, expect, it } from "vitest";
import { GET as delivery } from "@/app/api/v1/admin/campaigns/[id]/delivery/route";
import type { MarketingChannel } from "@/generated/prisma/client";
import { getDb } from "@/server/db/client";
import type { EmailMessage } from "@/server/email/email";
import { createSession } from "@/server/modules/auth/sessions";
import {
  createCampaignDeliveryService,
  DELIVERY_RETRY_STEP_MS,
} from "@/server/modules/marketing/delivery-service";
import type { PermissionCode } from "@/server/modules/rbac/catalog";
import { MS_PER_DAY, MS_PER_HOUR } from "@/server/time/time";
import type { WhatsAppMessage } from "@/server/whatsapp/whatsapp";
import { resetDatabase } from "@/test/integration/database";

/** Campaign delivery: consent recheck, frequency, retries, fallback, log (TASK-049, ADR-0067). */

const db = getDb();
const UNKNOWN_ID = "019a0000-0000-7000-8000-000000000000";

let counter = 0;
let now: Date;
let employeeId: string;
let emails: EmailMessage[];
let whatsapps: WhatsAppMessage[];
let whatsappFails: boolean;
let emailFails: boolean;

function service() {
  return createCampaignDeliveryService({
    db,
    clock: { now: () => now },
    email: {
      async send(message) {
        if (emailFails) throw new Error("smtp down");
        emails.push(message);
      },
    },
    whatsapp: {
      async send(message) {
        if (whatsappFails) throw new Error("provider down");
        whatsapps.push(message);
        return { reference: `wa-${whatsapps.length}` };
      },
    },
  });
}

async function staffToken(codes: PermissionCode[]) {
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
          employeeLevel: "MANAGER",
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
    include: { employee: true },
  });
  const session = await createSession(
    db,
    { accountId: account.id, domain: "EMPLOYEE", ttlMs: 12 * MS_PER_HOUR },
    { ip: null, userAgent: null },
    new Date(),
  );
  return { token: session.tokens.accessToken, employeeId: account.employee!.id };
}

async function customer(
  consents: Partial<Record<MarketingChannel, boolean>>,
  options: { emailVerified?: boolean } = {},
) {
  counter += 1;
  const account = await db.account.create({
    data: {
      accountType: "CUSTOMER",
      email: `c${counter}@example.com`,
      emailVerifiedAt: options.emailVerified === false ? null : now,
      passwordHash: "unused",
      status: "ACTIVE",
      customer: {
        create: {
          phone: `+2011${10000000 + counter}`,
          fullName: "Sara Ali",
          preferredLocale: "ar",
        },
      },
    },
    include: { customer: true },
  });
  const id = account.customer!.id;
  for (const [channel, optedIn] of Object.entries(consents)) {
    await optIn(id, channel as MarketingChannel, optedIn);
  }
  return id;
}

function optIn(customerId: string, channel: MarketingChannel, optedIn = true) {
  return db.marketingConsent.create({
    data: {
      customerId,
      channel,
      status: optedIn ? "OPTED_IN" : "OPTED_OUT",
      source: "CUSTOMER_ACCOUNT",
      occurredAt: now,
    },
  });
}

/** A SENDING campaign with these recipients (as the TASK-048 hand-off leaves it). */
async function sendingCampaign(channel: MarketingChannel, customerIds: string[]) {
  const campaign = await db.campaign.create({
    data: {
      name: "Eid",
      channel,
      status: "SENDING",
      segment: { type: "ALL_OPTED_IN", channel },
      subject: channel === "EMAIL" ? "Eid sale" : null,
      content: "20% off everything.",
      createdByEmployeeId: employeeId,
      sendingStartedAt: now,
      createdAt: now,
      updatedAt: now,
    },
  });
  await db.campaignRecipient.createMany({
    data: customerIds.map((customerId) => ({
      campaignId: campaign.id,
      customerId,
      channel,
      eligibilitySnapshot: { segmentType: "ALL_OPTED_IN", consentId: null },
      createdAt: now,
    })),
  });
  return campaign.id;
}

function setting(key: string, value: number) {
  return db.setting.create({ data: { key, valueJson: value, dataType: "INTEGER" } });
}

async function recipientOf(campaignId: string, customerId: string) {
  return db.campaignRecipient.findUniqueOrThrow({
    where: { campaignId_customerId: { campaignId, customerId } },
  });
}

async function getDelivery(token: string, id: string, query = "", status = 200) {
  const res = await (
    delivery as (r: Request, c: { params: Promise<{ id: string }> }) => Promise<Response>
  )(
    new Request(`http://localhost/api/v1/admin/campaigns/${id}/delivery${query}`, {
      headers: { authorization: `Bearer ${token}`, "accept-language": "en" },
    }),
    { params: Promise.resolve({ id }) },
  );
  const json = await res.json();
  expect(res.status, JSON.stringify(json)).toBe(status);
  return json;
}

beforeEach(async () => {
  await resetDatabase();
  now = new Date("2026-10-17T10:00:00Z");
  emails = [];
  whatsapps = [];
  whatsappFails = false;
  emailFails = false;
  employeeId = (await staffToken([])).employeeId;
});

describe("campaign delivery", () => {
  it("rechecks consent and address at delivery, logs attempts and completes", async () => {
    const reachable = await customer({ EMAIL: true });
    const optedOut = await customer({ EMAIL: true });
    const unverified = await customer({ EMAIL: true }, { emailVerified: false });
    const id = await sendingCampaign("EMAIL", [reachable, optedOut, unverified]);
    await optIn(optedOut, "EMAIL", false); // After "send": the opt-out wins (User Flows §16.2).

    const result = await service().deliverPending();
    expect(result).toMatchObject({ sent: 1, skipped: 2, failed: 0, campaignsEnded: 1 });
    expect(emails).toEqual([
      {
        to: expect.stringMatching(/@example\.com$/),
        subject: "Eid sale",
        text: "20% off everything.",
      },
    ]);
    expect(await recipientOf(id, reachable)).toMatchObject({ status: "SENT", sentAt: now });
    expect(await recipientOf(id, optedOut)).toMatchObject({
      status: "SKIPPED",
      skipReason: "CONSENT_WITHDRAWN",
    });
    expect(await recipientOf(id, unverified)).toMatchObject({
      status: "SKIPPED",
      skipReason: "NO_ADDRESS",
    });
    const log = await db.notificationDelivery.findMany({
      where: { campaignRecipient: { campaignId: id } },
    });
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({
      templateKey: "MARKETING_CAMPAIGN",
      channel: "EMAIL",
      locale: "ar",
      attemptNumber: 1,
      status: "SENT",
    });

    const campaign = await db.campaign.findUniqueOrThrow({ where: { id } });
    expect(campaign.status).toBe("COMPLETED");
    const audit = await db.auditLog.findFirstOrThrow({
      where: { entityId: id, action: "CAMPAIGN_COMPLETED" },
    });
    expect(audit).toMatchObject({ actorType: "SYSTEM", actorId: null });
    expect(audit.newDataJson).toMatchObject({ status: "COMPLETED", sent: 1, skipped: 2 });

    // A second run sends nothing again.
    expect(await service().deliverPending()).toMatchObject({ sent: 0, campaignsEnded: 0 });
    expect(emails).toHaveLength(1);
  });

  it("retries WhatsApp, then falls back to email only with email marketing consent", async () => {
    await setting("marketing.delivery_max_attempts", 2);
    whatsappFails = true;
    const withEmail = await customer({ WHATSAPP: true, EMAIL: true });
    const withoutEmail = await customer({ WHATSAPP: true });
    const id = await sendingCampaign("WHATSAPP", [withEmail, withoutEmail]);

    expect(await service().deliverPending()).toMatchObject({ retrying: 2, campaignsEnded: 0 });
    const waiting = await recipientOf(id, withEmail);
    expect(waiting).toMatchObject({ status: "PENDING", attemptCount: 1 });
    expect(waiting.nextAttemptAt).toEqual(new Date(now.getTime() + DELIVERY_RETRY_STEP_MS));
    // Not due yet.
    expect(await service().deliverPending()).toMatchObject({ retrying: 0, failed: 0 });

    now = new Date(now.getTime() + DELIVERY_RETRY_STEP_MS);
    expect(await service().deliverPending()).toMatchObject({
      sent: 1,
      failed: 1,
      campaignsEnded: 1,
    });
    expect(emails).toEqual([
      { to: expect.any(String), subject: "BeautyFits", text: "20% off everything." },
    ]);
    expect(await recipientOf(id, withEmail)).toMatchObject({ status: "FALLBACK_SENT" });
    expect(await recipientOf(id, withoutEmail)).toMatchObject({
      status: "FAILED",
      failureReason: "provider down",
    });
    const attempts = await db.notificationDelivery.findMany({
      where: { campaignRecipient: { customerId: withEmail } },
      orderBy: { attemptNumber: "asc" },
    });
    expect(attempts.map((a) => [a.attemptNumber, a.channel, a.status])).toEqual([
      [1, "WHATSAPP", "FAILED"],
      [2, "WHATSAPP", "FAILED"],
      [3, "EMAIL", "FALLBACK_SENT"],
    ]);
    expect((await db.campaign.findUniqueOrThrow({ where: { id } })).status).toBe("COMPLETED");
  });

  it("ends FAILED when nothing was delivered", async () => {
    await setting("marketing.delivery_max_attempts", 1);
    emailFails = true;
    const id = await sendingCampaign("EMAIL", [await customer({ EMAIL: true })]);
    expect(await service().deliverPending()).toMatchObject({ failed: 1, campaignsEnded: 1 });
    expect((await db.campaign.findUniqueOrThrow({ where: { id } })).status).toBe("FAILED");
    expect(await db.auditLog.count({ where: { entityId: id, action: "CAMPAIGN_FAILED" } })).toBe(1);
  });

  it("applies the frequency limit only when configured", async () => {
    const recent = await customer({ EMAIL: true });
    const old = await customer({ EMAIL: true });
    const earlier = await sendingCampaign("EMAIL", [recent, old]);
    await db.campaignRecipient.update({
      where: { campaignId_customerId: { campaignId: earlier, customerId: recent } },
      data: { status: "SENT", sentAt: new Date(now.getTime() - 2 * MS_PER_DAY) },
    });
    await db.campaignRecipient.update({
      where: { campaignId_customerId: { campaignId: earlier, customerId: old } },
      data: { status: "SENT", sentAt: new Date(now.getTime() - 10 * MS_PER_DAY) },
    });

    // Default 0: no limit.
    const unlimited = await sendingCampaign("EMAIL", [recent]);
    await service().deliverPending();
    expect(await recipientOf(unlimited, recent)).toMatchObject({ status: "SENT" });

    await setting("marketing.frequency_max_messages", 2);
    const limited = await sendingCampaign("EMAIL", [recent, old]);
    expect(await service().deliverPending()).toMatchObject({ sent: 1, skipped: 1 });
    expect(await recipientOf(limited, recent)).toMatchObject({
      status: "SKIPPED",
      skipReason: "FREQUENCY_LIMIT",
    });
    expect(await recipientOf(limited, old)).toMatchObject({ status: "SENT" });
  });

  it("skips campaigns that are not SENDING", async () => {
    const id = await sendingCampaign("EMAIL", [await customer({ EMAIL: true })]);
    await db.campaign.update({ where: { id }, data: { status: "APPROVED" } });
    expect(await service().deliverPending()).toMatchObject({ sent: 0, campaignsEnded: 0 });
    expect(emails).toHaveLength(0);
  });
});

describe("GET /admin/campaigns/{id}/delivery", () => {
  it("returns stats and recipients with their attempts", async () => {
    const viewer = await staffToken(["MARKETING_VIEW"]);
    const sent = await customer({ EMAIL: true });
    const skipped = await customer({ EMAIL: true }, { emailVerified: false });
    const id = await sendingCampaign("EMAIL", [sent, skipped]);
    await service().deliverPending();

    const body = await getDelivery(viewer.token, id);
    expect(body.data.campaignId).toBe(id);
    expect(body.data.status).toBe("COMPLETED");
    expect(body.data.stats).toEqual({
      recipients: 2,
      byStatus: { PENDING: 0, SENT: 1, FALLBACK_SENT: 0, FAILED: 0, SKIPPED: 1 },
      skipped: { CONSENT_WITHDRAWN: 0, FREQUENCY_LIMIT: 0, NO_ADDRESS: 1 },
      attempts: { EMAIL: { sent: 1, failed: 0 }, WHATSAPP: { sent: 0, failed: 0 } },
    });
    expect(body.meta.pagination.total).toBe(2);
    const filtered = await getDelivery(viewer.token, id, "?status=SENT");
    expect(filtered.data.recipients).toHaveLength(1);
    expect(filtered.data.recipients[0]).toMatchObject({
      customerId: sent,
      status: "SENT",
      attempts: [{ attemptNumber: 1, channel: "EMAIL", status: "SENT" }],
    });
    // No contact data in the response.
    expect(JSON.stringify(filtered.data)).not.toContain("@example.com");
  });

  it("checks permission, id and query", async () => {
    const viewer = await staffToken(["MARKETING_VIEW"]);
    const other = await staffToken(["MARKETING_CREATE"]);
    const id = await sendingCampaign("EMAIL", [await customer({ EMAIL: true })]);
    await getDelivery(other.token, id, "", 403);
    await getDelivery(viewer.token, UNKNOWN_ID, "", 404);
    await getDelivery(viewer.token, id, "?status=NOPE", 400);
  });
});
