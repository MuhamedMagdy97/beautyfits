import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { GET, PATCH } from "@/app/api/v1/me/marketing-consents/route";
import { getDb } from "@/server/db/client";
import { createSession } from "@/server/modules/auth/sessions";
import { MS_PER_DAY } from "@/server/time/time";
import { resetDatabase } from "@/test/integration/database";

/** HTTP-level tests of /me/marketing-consents (TASK-046, Q59, Q60, ADR-0051). */

const db = getDb();
const BASE = "http://localhost/api/v1/me/marketing-consents";

type Handler = (request: Request, context: { params: Promise<never> }) => Promise<Response>;

function call(handler: unknown, token: string | null, body?: unknown): Promise<Response> {
  const headers = new Headers();
  if (token) {
    headers.set("authorization", `Bearer ${token}`);
  }
  if (body !== undefined) {
    headers.set("content-type", "application/json");
  }
  return (handler as Handler)(
    new Request(BASE, {
      method: body === undefined ? "GET" : "PATCH",
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    { params: Promise.resolve({}) as Promise<never> },
  );
}

async function data(res: Response, status = 200) {
  const body = await res.json();
  expect(res.status, JSON.stringify(body)).toBe(status);
  return body.data;
}

let counter = 0;

async function customer() {
  counter += 1;
  const now = new Date();
  const account = await db.account.create({
    data: {
      accountType: "CUSTOMER",
      email: `m${counter}@example.com`,
      emailVerifiedAt: now,
      passwordHash: "unused",
      status: "ACTIVE",
      customer: {
        create: { phone: `+2010${20000000 + counter}`, phoneVerifiedAt: now, fullName: "Mona" },
      },
    },
    include: { customer: true },
  });
  const session = await createSession(
    db,
    { accountId: account.id, domain: "CUSTOMER", ttlMs: 30 * MS_PER_DAY },
    { ip: null, userAgent: null },
    now,
  );
  return { customerId: account.customer!.id, token: session.tokens.accessToken };
}

function history(customerId: string) {
  return db.marketingConsent.findMany({
    where: { customerId },
    orderBy: { id: "asc" },
    select: { channel: true, status: true, source: true, purpose: true },
  });
}

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await db.$disconnect();
});

describe("marketing consents", () => {
  it("needs a customer session", async () => {
    expect((await call(GET, null)).status).toBe(401);
    expect((await call(PATCH, null, { email: true })).status).toBe(401);
  });

  it("starts opted out of every channel (Q59: never pre-enabled)", async () => {
    const { token } = await customer();
    expect(await data(await call(GET, token))).toEqual({
      email: { optedIn: false, changedAt: null },
      whatsapp: { optedIn: false, changedAt: null },
    });
  });

  it("opts in and out per channel and keeps the full history (Q60)", async () => {
    const { customerId, token } = await customer();

    const afterIn = await data(await call(PATCH, token, { email: true, whatsapp: true }));
    expect(afterIn.email.optedIn).toBe(true);
    expect(afterIn.whatsapp.optedIn).toBe(true);
    expect(afterIn.email.changedAt).toEqual(expect.any(String));

    // Email opt-out leaves WhatsApp alone.
    const afterOut = await data(await call(PATCH, token, { email: false }));
    expect(afterOut.email.optedIn).toBe(false);
    expect(afterOut.whatsapp).toEqual(afterIn.whatsapp);
    expect(await data(await call(GET, token))).toEqual(afterOut);

    // No change, no new row.
    await data(await call(PATCH, token, { email: false, whatsapp: true }));

    expect(await history(customerId)).toEqual([
      { channel: "EMAIL", status: "OPTED_IN", source: "CUSTOMER_ACCOUNT", purpose: "MARKETING" },
      { channel: "WHATSAPP", status: "OPTED_IN", source: "CUSTOMER_ACCOUNT", purpose: "MARKETING" },
      { channel: "EMAIL", status: "OPTED_OUT", source: "CUSTOMER_ACCOUNT", purpose: "MARKETING" },
    ]);
  });

  it("only touches the signed-in customer's consent", async () => {
    const first = await customer();
    const second = await customer();
    await data(await call(PATCH, first.token, { whatsapp: true }));
    expect((await data(await call(GET, second.token))).whatsapp.optedIn).toBe(false);
    expect(await history(second.customerId)).toEqual([]);
  });

  it("rejects an empty or invalid body", async () => {
    const { token } = await customer();
    expect((await call(PATCH, token, {})).status).toBe(400);
    expect((await call(PATCH, token, { email: "yes" })).status).toBe(400);
  });

  it("serializes concurrent changes: the latest row is always the state", async () => {
    const { customerId, token } = await customer();
    await Promise.all([
      call(PATCH, token, { email: true }),
      call(PATCH, token, { email: true }),
      call(PATCH, token, { email: true }),
    ]);
    expect(await history(customerId)).toHaveLength(1);
  });

  it("is append-only in the database", async () => {
    const { customerId, token } = await customer();
    await data(await call(PATCH, token, { email: true }));
    await expect(
      db.marketingConsent.updateMany({ where: { customerId }, data: { status: "OPTED_OUT" } }),
    ).rejects.toThrow(/append-only/);
    await expect(db.marketingConsent.deleteMany({ where: { customerId } })).rejects.toThrow(
      /append-only/,
    );
  });
});
