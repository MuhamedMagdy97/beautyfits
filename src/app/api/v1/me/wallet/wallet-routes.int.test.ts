import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { POST as adjustWallet } from "@/app/api/v1/admin/customers/[id]/wallet/adjust/route";
import { GET as getCustomerWallet } from "@/app/api/v1/admin/customers/[id]/wallet/route";
import { GET as getCustomerTransactions } from "@/app/api/v1/admin/customers/[id]/wallet/transactions/route";
import { POST as deactivate } from "@/app/api/v1/me/deactivate/route";
import { GET as getWallet } from "@/app/api/v1/me/wallet/route";
import { GET as getTransactions } from "@/app/api/v1/me/wallet/transactions/route";
import type { EmployeeLevel } from "@/generated/prisma/client";
import { getDb } from "@/server/db/client";
import { runInTransaction } from "@/server/db/transaction";
import { AppError } from "@/server/errors/app-error";
import { createScryptHasher } from "@/server/modules/auth/password-hash";
import { createSession } from "@/server/modules/auth/sessions";
import type { PermissionCode } from "@/server/modules/rbac/catalog";
import {
  captureWalletReservation,
  creditWallet,
  releaseWalletReservation,
  reserveWallet,
} from "@/server/modules/wallet/wallet-service";
import { MS_PER_DAY, MS_PER_HOUR } from "@/server/time/time";
import { resetDatabase } from "@/test/integration/database";
import { bareOrder, bareOrders } from "@/test/integration/orders";

/** Wallet ledger, reservations, adjustments and the R34 check (TASK-028, Q78, Q166–Q170, C4). */

const db = getDb();
const BASE = "http://localhost/api/v1";
const PASSWORD = "teal lantern over the nile";
const UNKNOWN_ID = "019a0000-0000-7000-8000-000000000000";

type Handler = (request: Request, context: { params: Promise<never> }) => Promise<Response>;

function call(
  handler: unknown,
  path: string,
  options: {
    method?: string;
    token?: string;
    key?: string;
    body?: unknown;
    params?: Record<string, string>;
  } = {},
): Promise<Response> {
  const headers = new Headers({ "accept-language": "en" });
  if (options.token) headers.set("authorization", `Bearer ${options.token}`);
  if (options.key) headers.set("idempotency-key", options.key);
  if (options.body !== undefined) headers.set("content-type", "application/json");
  return (handler as Handler)(
    new Request(`${BASE}${path}`, {
      method: options.method ?? "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    }),
    { params: Promise.resolve(options.params ?? {}) as Promise<never> },
  );
}

async function data(res: Response, status = 200) {
  const body = res.status === 204 ? null : await res.json();
  expect(res.status, JSON.stringify(body)).toBe(status);
  return body?.data;
}

async function errorOf(res: Response, status: number) {
  const body = await res.json();
  expect(res.status, JSON.stringify(body)).toBe(status);
  return body.error;
}

let passwordHash: string;
let counter = 0;

async function customer() {
  counter += 1;
  const now = new Date();
  const account = await db.account.create({
    data: {
      accountType: "CUSTOMER",
      email: `c${counter}@example.com`,
      emailVerifiedAt: now,
      passwordHash,
      status: "ACTIVE",
      customer: {
        create: {
          phone: `+2010${10000000 + counter}`,
          phoneVerifiedAt: now,
          fullName: "Sara Ali",
          preferredLocale: "en",
        },
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
  return { id: account.customer!.id, token: session.tokens.accessToken };
}

async function staff(level: EmployeeLevel, codes: PermissionCode[] = []) {
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
    include: { employee: true },
  });
  const created = await createSession(
    db,
    { accountId: account.id, domain: "EMPLOYEE", ttlMs: 12 * MS_PER_HOUR },
    { ip: null, userAgent: null },
    new Date(),
  );
  return { employeeId: account.employee!.id, token: created.tokens.accessToken };
}

let admin: { employeeId: string; token: string };

function adjust(customerId: string, body: unknown, key: string = randomUUID()) {
  return call(adjustWallet, `/admin/customers/${customerId}/wallet/adjust`, {
    method: "POST",
    token: admin.token,
    key,
    body,
    params: { id: customerId },
  });
}

async function credit(customerId: string, amount: number) {
  await data(await adjust(customerId, { direction: "CREDIT", amount, reason: "Goodwill" }), 201);
}

function tx<T>(fn: Parameters<typeof runInTransaction<T>>[0]) {
  return runInTransaction(fn, {}, db);
}

async function refusal(promise: Promise<unknown>): Promise<AppError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AppError);
  return error as AppError;
}

beforeAll(async () => {
  passwordHash = await createScryptHasher().hash(PASSWORD);
});

beforeEach(async () => {
  await resetDatabase();
  admin = await staff("ADMIN");
});

afterAll(async () => {
  await db.$disconnect();
});

describe("manual adjustment (Q78)", () => {
  it("is Owner/Admin only, needs an Idempotency-Key and validates the body", async () => {
    const { id } = await customer();
    const manager = await staff("MANAGER", ["ADJUST_WALLET", "VIEW_WALLET_BALANCE"]);
    await errorOf(
      await call(adjustWallet, `/admin/customers/${id}/wallet/adjust`, {
        method: "POST",
        token: manager.token,
        key: randomUUID(),
        body: { direction: "CREDIT", amount: 100, reason: "x" },
        params: { id },
      }),
      403,
    );
    // VIEW_WALLET_BALANCE can be granted to a manager.
    await data(
      await call(getCustomerWallet, `/admin/customers/${id}/wallet`, {
        token: manager.token,
        params: { id },
      }),
    );
    const viewer = await staff("EMPLOYEE");
    await errorOf(
      await call(getCustomerWallet, `/admin/customers/${id}/wallet`, {
        token: viewer.token,
        params: { id },
      }),
      403,
    );
    await errorOf(
      await call(adjustWallet, `/admin/customers/${id}/wallet/adjust`, {
        method: "POST",
        token: admin.token,
        body: { direction: "CREDIT", amount: 100, reason: "x" },
        params: { id },
      }),
      400,
    );
    for (const body of [
      { direction: "CREDIT", amount: 0, reason: "x" },
      { direction: "CREDIT", amount: 1.5, reason: "x" },
      { direction: "CREDIT", amount: 100, reason: " " },
      { direction: "UP", amount: 100, reason: "x" },
    ]) {
      expect((await errorOf(await adjust(id, body), 400)).code).toBe("VALIDATION_ERROR");
    }
    await errorOf(await adjust(UNKNOWN_ID, { direction: "CREDIT", amount: 1, reason: "x" }), 404);
  });

  it("writes one ledger entry with its reason, audits it and replays a retried key", async () => {
    const { id } = await customer();
    const key = randomUUID();
    const body = { direction: "CREDIT", amount: 50_000, reason: "Courier damaged parcel" };
    const first = await data(await adjust(id, body, key), 201);
    expect(first.wallet).toEqual({
      customerId: id,
      currency: "EGP",
      balance: 50_000,
      reserved: 0,
      available: 50_000,
    });
    const again = await data(await adjust(id, body, key), 201);
    expect(again.transactionId).toBe(first.transactionId);
    expect(await db.walletTransaction.count()).toBe(1);
    expect((await errorOf(await adjust(id, { ...body, amount: 1 }, key), 409)).code).toBe(
      "IDEMPOTENCY_CONFLICT",
    );

    const audit = await db.auditLog.findFirstOrThrow({ where: { action: "WALLET_ADJUSTED" } });
    expect(audit).toMatchObject({
      actorId: admin.employeeId,
      entityType: "CUSTOMER",
      entityId: id,
      reason: "Courier damaged parcel",
    });
    expect(audit.newDataJson).toMatchObject({
      direction: "CREDIT",
      amount: 50_000,
      balance: 50_000,
    });

    const ledger = await data(
      await call(getCustomerTransactions, `/admin/customers/${id}/wallet/transactions`, {
        token: admin.token,
        params: { id },
      }),
    );
    expect(ledger).toEqual([
      expect.objectContaining({
        id: first.transactionId,
        type: "MANUAL_ADJUSTMENT",
        signedAmount: 50_000,
        reason: "Courier damaged parcel",
      }),
    ]);
  });

  it("debits only available credit, never held credit", async () => {
    const { id } = await customer();
    await credit(id, 50_000);
    const orderId = await bareOrder();
    await tx((t) =>
      reserveWallet(t, {
        customerId: id,
        orderId,
        amount: BigInt(30_000),
        now: new Date(),
      }),
    );
    const refused = await errorOf(
      await adjust(id, { direction: "DEBIT", amount: 20_001, reason: "Correction" }),
      422,
    );
    expect(refused).toMatchObject({
      code: "WALLET_INSUFFICIENT_FUNDS",
      details: { available: 20_000 },
    });
    const done = await data(
      await adjust(id, { direction: "DEBIT", amount: 20_000, reason: "Correction" }),
      201,
    );
    expect(done.wallet).toMatchObject({ balance: 30_000, reserved: 30_000, available: 0 });
  });

  it("refuses a deactivated customer", async () => {
    const { id } = await customer();
    await db.customer.update({ where: { id }, data: { anonymizedAt: new Date() } });
    const error = await errorOf(
      await adjust(id, { direction: "CREDIT", amount: 1, reason: "x" }),
      409,
    );
    expect(error.details.reason).toBe("CUSTOMER_DEACTIVATED");
  });
});

describe("customer wallet (Q166)", () => {
  it("shows an empty wallet, then the balance and the ledger without staff reasons", async () => {
    const { id, token } = await customer();
    expect(await data(await call(getWallet, "/me/wallet", { token }))).toEqual({
      customerId: id,
      currency: "EGP",
      balance: 0,
      reserved: 0,
      available: 0,
    });
    await credit(id, 12_345);
    expect(await data(await call(getWallet, "/me/wallet", { token }))).toMatchObject({
      balance: 12_345,
      available: 12_345,
    });
    const [entry] = await data(await call(getTransactions, "/me/wallet/transactions", { token }));
    expect(entry).toMatchObject({ type: "MANUAL_ADJUSTMENT", direction: "CREDIT", amount: 12_345 });
    expect(entry).not.toHaveProperty("reason");
    expect((await call(getWallet, "/me/wallet")).status).toBe(401);
  });
});

describe("reservations (C4, User Flows §12.2, Audit Correction 5)", () => {
  it("holds, releases and captures an order's credit; release and capture are idempotent", async () => {
    const { id } = await customer();
    await credit(id, 50_000);
    const now = new Date();
    const [orderA, orderB] = await bareOrders(2);

    await tx((t) =>
      reserveWallet(t, { customerId: id, orderId: orderA, amount: BigInt(50_000), now }),
    );
    expect(
      (
        await refusal(
          tx((t) => reserveWallet(t, { customerId: id, orderId: orderB, amount: BigInt(1), now })),
        )
      ).code,
    ).toBe("WALLET_INSUFFICIENT_FUNDS");
    expect(
      (
        await refusal(
          tx((t) => reserveWallet(t, { customerId: id, orderId: orderA, amount: BigInt(1), now })),
        )
      ).code,
    ).toBe("WALLET_RESERVATION_CONFLICT");

    // Release: not a refund, no ledger entry.
    expect(await tx((t) => releaseWalletReservation(t, { orderId: orderA, now }))).toBe(
      BigInt(50_000),
    );
    expect(await tx((t) => releaseWalletReservation(t, { orderId: orderA, now }))).toBe(BigInt(0));
    expect(await db.walletTransaction.count()).toBe(1);

    // Capture: an ORDER_WALLET_USE debit referencing the order.
    await tx((t) =>
      reserveWallet(t, { customerId: id, orderId: orderB, amount: BigInt(30_000), now }),
    );
    expect(await tx((t) => captureWalletReservation(t, { orderId: orderB, now }))).toBe(
      BigInt(30_000),
    );
    expect(await tx((t) => captureWalletReservation(t, { orderId: orderB, now }))).toBe(BigInt(0));
    expect(await tx((t) => captureWalletReservation(t, { orderId: orderA, now }))).toBe(BigInt(0));
    expect(await tx((t) => releaseWalletReservation(t, { orderId: randomUUID(), now }))).toBe(
      BigInt(0),
    );
    const use = await db.walletTransaction.findFirstOrThrow({
      where: { transactionType: "ORDER_WALLET_USE" },
    });
    expect(use).toMatchObject({
      direction: "DEBIT",
      amount: BigInt(30_000),
      referenceType: "ORDER",
      referenceId: orderB,
    });
    const wallet = await db.wallet.findUniqueOrThrow({ where: { customerId: id } });
    expect(wallet.balance).toBe(BigInt(20_000));
  });

  it("refuses a customer without a wallet", async () => {
    const { id } = await customer();
    const orderId = await bareOrder();
    const error = await refusal(
      tx((t) =>
        reserveWallet(t, {
          customerId: id,
          orderId,
          amount: BigInt(1),
          now: new Date(),
        }),
      ),
    );
    expect(error).toMatchObject({ code: "WALLET_INSUFFICIENT_FUNDS", details: { available: 0 } });
  });

  it("never lets two orders spend the same credit", async () => {
    const { id } = await customer();
    await credit(id, 50_000);
    const orders = await bareOrders(5);
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, (_, i) =>
        tx((t) =>
          reserveWallet(t, {
            customerId: id,
            orderId: orders[i],
            amount: BigInt(30_000),
            now: new Date(),
          }),
        ),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.walletReservation.count({ where: { status: "ACTIVE" } })).toBe(1);
  });
});

describe("refund credit", () => {
  it("creates the wallet on first credit and records the reference", async () => {
    const { id } = await customer();
    const returnId = randomUUID();
    await tx((t) =>
      creditWallet(t, {
        customerId: id,
        transactionType: "RETURN_REFUND",
        amount: BigInt(7_500),
        referenceType: "RETURN",
        referenceId: returnId,
        now: new Date(),
      }),
    );
    const wallet = await db.wallet.findUniqueOrThrow({
      where: { customerId: id },
      include: { transactions: true },
    });
    expect(wallet.balance).toBe(BigInt(7_500));
    expect(wallet.transactions[0]).toMatchObject({
      referenceType: "RETURN",
      referenceId: returnId,
    });
  });
});

describe("database guards (Q170)", () => {
  it("changes a balance only through the append-only ledger and never below zero", async () => {
    const { id } = await customer();
    await credit(id, 1_000);
    const wallet = await db.wallet.findUniqueOrThrow({ where: { customerId: id } });
    await expect(
      db.$executeRaw`UPDATE wallets SET balance = 999999 WHERE id = ${wallet.id}::uuid`,
    ).rejects.toThrow(/only through wallet_transactions/);
    await expect(
      db.$executeRaw`DELETE FROM wallets WHERE id = ${wallet.id}::uuid`,
    ).rejects.toThrow();
    await expect(db.$executeRaw`UPDATE wallet_transactions SET amount = 1`).rejects.toThrow(
      /append-only/,
    );
    await expect(db.$executeRaw`DELETE FROM wallet_transactions`).rejects.toThrow(/append-only/);
    await expect(
      db.walletTransaction.create({
        data: {
          walletId: wallet.id,
          transactionType: "MANUAL_ADJUSTMENT",
          direction: "DEBIT",
          amount: BigInt(1_001),
        },
      }),
    ).rejects.toThrow(/wallets_balance_check/);
    const other = await customer();
    await expect(
      db.$executeRaw`INSERT INTO wallets (id, customer_id, balance)
        VALUES (${randomUUID()}::uuid, ${other.id}::uuid, 5)`,
    ).rejects.toThrow(/starts empty/);
    expect((await db.wallet.findUniqueOrThrow({ where: { id: wallet.id } })).balance).toBe(
      BigInt(1_000),
    );
  });
});

describe("deactivation (R34)", () => {
  it("is refused while the wallet holds credit", async () => {
    const { id, token } = await customer();
    await credit(id, 500);
    const deactivateMe = () =>
      call(deactivate, "/me/deactivate", {
        method: "POST",
        token,
        body: { currentPassword: PASSWORD },
      });
    const error = await errorOf(await deactivateMe(), 409);
    expect(error.details).toMatchObject({
      reason: "ACCOUNT_HAS_OPEN_ITEMS",
      openItems: ["WALLET_BALANCE"],
    });
    await data(await adjust(id, { direction: "DEBIT", amount: 500, reason: "Paid out" }), 201);
    await data(await deactivateMe(), 204);
  });
});
