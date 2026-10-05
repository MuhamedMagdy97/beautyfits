import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { PATCH as patchArea } from "@/app/api/v1/admin/areas/[id]/route";
import { POST as createArea } from "@/app/api/v1/admin/governorates/[id]/areas/route";
import { PATCH as patchGovernorate } from "@/app/api/v1/admin/governorates/[id]/route";
import { GET as adminLocations } from "@/app/api/v1/admin/locations/route";
import { GET as publicLocations } from "@/app/api/v1/locations/route";
import {
  DELETE as deleteAddress,
  PATCH as patchAddress,
} from "@/app/api/v1/me/addresses/[addressId]/route";
import { POST as setDefault } from "@/app/api/v1/me/addresses/[addressId]/set-default/route";
import { GET as listAddresses, POST as createAddress } from "@/app/api/v1/me/addresses/route";
import { POST as register } from "@/app/api/v1/auth/register/route";
import { POST as changeEmail } from "@/app/api/v1/me/change-email/route";
import { POST as verifyEmailChange } from "@/app/api/v1/me/change-email/verify/route";
import { POST as changePhone } from "@/app/api/v1/me/change-phone/route";
import { POST as verifyPhoneChange } from "@/app/api/v1/me/change-phone/verify/route";
import { POST as deactivate } from "@/app/api/v1/me/deactivate/route";
import { GET as getMe, PATCH as patchMe } from "@/app/api/v1/me/route";
import type { EmployeeLevel } from "@/generated/prisma/client";
import { getEnv } from "@/server/config/env";
import { getDb } from "@/server/db/client";
import { createScryptHasher } from "@/server/modules/auth/password-hash";
import { createSession } from "@/server/modules/auth/sessions";
import { MAX_ADDRESSES } from "@/server/modules/customers/addresses-service";
import type { PermissionCode } from "@/server/modules/rbac/catalog";
import { MS_PER_DAY, MS_PER_HOUR } from "@/server/time/time";
import { resetDatabase } from "@/test/integration/database";
import { bareOrder } from "@/test/integration/orders";

/** HTTP-level tests of /me, /locations and the admin location endpoints (TASK-009, API §11). */

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
    headers?: Record<string, string>;
    body?: unknown;
    params?: Record<string, string>;
  } = {},
): Promise<Response> {
  const headers = new Headers(options.headers);
  if (options.token) {
    headers.set("authorization", `Bearer ${options.token}`);
  }
  if (options.body !== undefined) {
    headers.set("content-type", "application/json");
  }
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

/** An ACTIVE customer with a live session. */
async function customer(email?: string, phone?: string) {
  counter += 1;
  email ??= `c${counter}@example.com`;
  phone ??= `+2010${10000000 + counter}`;
  const now = new Date();
  const account = await db.account.create({
    data: {
      accountType: "CUSTOMER",
      email,
      emailVerifiedAt: now,
      passwordHash,
      status: "ACTIVE",
      customer: {
        create: { phone, phoneVerifiedAt: now, fullName: "Sara Ali", preferredLocale: "en" },
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
  return { account, customer: account.customer!, token: session.tokens.accessToken };
}

/** An employee with a live session and the given permissions. */
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
  return { employee: account.employee!, token: created.tokens.accessToken };
}

/** Decoded text bodies of the mails sent to `to`, newest first. */
async function mailsTo(to: string): Promise<string[]> {
  const dir = getEnv().MAIL_DIR;
  const files = (await readdir(dir).catch(() => [] as string[])).filter((n) => n.endsWith(".eml"));
  const bodies: string[] = [];
  for (const name of files.sort().reverse()) {
    const eml = await readFile(join(dir, name), "utf8");
    if (eml.includes(`\r\nTo: ${to}\r\n`)) {
      bodies.push(
        Buffer.from(eml.split("\r\n\r\n")[1].replace(/\s/g, ""), "base64").toString("utf8"),
      );
    }
  }
  return bodies;
}

async function mailedCode(to: string): Promise<string> {
  for (const body of await mailsTo(to)) {
    const match = /\b(\d{6})\b/.exec(body);
    if (match) {
      return match[1];
    }
  }
  throw new Error(`no code mailed to ${to}`);
}

async function governorate(code: string) {
  return db.governorate.findUniqueOrThrow({ where: { code } });
}

async function area(governorateCode = "C", nameEn = "Nasr City", nameAr = "مدينة نصر") {
  const gov = await governorate(governorateCode);
  return db.area.create({ data: { governorateId: gov.id, nameEn, nameAr } });
}

function addressBody(areaId: string, extra: Record<string, unknown> = {}) {
  return {
    recipientName: "Mona Ali",
    phone: "01112345678",
    areaId,
    street: "12 Abbas El Akkad St",
    ...extra,
  };
}

beforeAll(async () => {
  passwordHash = await createScryptHasher().hash(PASSWORD);
});

beforeEach(async () => {
  await resetDatabase();
  await db.governorate.updateMany({ data: { status: "ACTIVE" } });
  await rm(getEnv().MAIL_DIR, { recursive: true, force: true });
});

afterAll(async () => {
  await db.$disconnect();
});

describe("profile", () => {
  it("reads and edits the profile of an active customer", async () => {
    expect((await call(getMe, "/me")).status).toBe(401);
    const { token } = await customer("sara@example.com");
    const me = await data(await call(getMe, "/me", { token }));
    expect(me.account).toMatchObject({ email: "sara@example.com", status: "ACTIVE" });
    expect(me.customer).toMatchObject({ fullName: "Sara Ali", dateOfBirth: null });

    const updated = await data(
      await call(patchMe, "/me", {
        method: "PATCH",
        token,
        body: { fullName: "  Sara Mahmoud ", preferredLocale: "ar", dateOfBirth: "1995-04-30" },
      }),
    );
    expect(updated.customer).toMatchObject({
      fullName: "Sara Mahmoud",
      preferredLocale: "ar",
      dateOfBirth: "1995-04-30",
    });
    const cleared = await data(
      await call(patchMe, "/me", { method: "PATCH", token, body: { dateOfBirth: null } }),
    );
    expect(cleared.customer.dateOfBirth).toBeNull();

    const error = await errorOf(
      await call(patchMe, "/me", { method: "PATCH", token, body: { dateOfBirth: "2999-01-01" } }),
      400,
    );
    expect(error.code).toBe("VALIDATION_ERROR");
  });

  it("refuses a pending account", async () => {
    const { account, token } = await customer();
    await db.account.update({
      where: { id: account.id },
      data: { status: "PENDING_VERIFICATION" },
    });
    expect((await call(getMe, "/me", { token })).status).toBe(403);
  });
});

describe("email change (Q152)", () => {
  it("needs the password and a code sent to the new email, then notifies the old one", async () => {
    const { customer: profile, token } = await customer("old@example.com");

    const wrong = await errorOf(
      await call(changeEmail, "/me/change-email", {
        method: "POST",
        token,
        body: { currentPassword: "not my password", newEmail: "new@example.com" },
      }),
      401,
    );
    expect(wrong.code).toBe("AUTH_INVALID_CREDENTIALS");

    const same = await errorOf(
      await call(changeEmail, "/me/change-email", {
        method: "POST",
        token,
        body: { currentPassword: PASSWORD, newEmail: "OLD@example.com" },
      }),
      400,
    );
    expect(same.details.issues[0]).toMatchObject({ path: "newEmail", code: "same_as_current" });

    const sent = await data(
      await call(changeEmail, "/me/change-email", {
        method: "POST",
        token,
        body: { currentPassword: PASSWORD, newEmail: "New@Example.com" },
      }),
      202,
    );
    expect(sent).toEqual({ codeSent: true, cooldownSeconds: 60 });
    const code = await mailedCode("new@example.com");

    const bad = await errorOf(
      await call(verifyEmailChange, "/me/change-email/verify", {
        method: "POST",
        token,
        body: { code: code === "000000" ? "111111" : "000000" },
      }),
      401,
    );
    expect(bad).toMatchObject({ code: "AUTH_OTP_INVALID", details: { attemptsRemaining: 4 } });

    const changed = await data(
      await call(verifyEmailChange, "/me/change-email/verify", {
        method: "POST",
        token,
        body: { code },
      }),
    );
    expect(changed.account).toMatchObject({ email: "new@example.com", emailVerified: true });
    expect((await mailsTo("old@example.com"))[0]).toContain("email address of your BeautyFits");

    const audit = await db.auditLog.findFirstOrThrow({
      where: { action: "CUSTOMER_EMAIL_CHANGED" },
    });
    expect(audit).toMatchObject({
      actorType: "CUSTOMER",
      actorId: profile.id,
      entityId: profile.id,
      previousDataJson: { email: "old@example.com" },
      newDataJson: { email: "new@example.com" },
    });

    // The code is single-use.
    expect(
      (
        await call(verifyEmailChange, "/me/change-email/verify", {
          method: "POST",
          token,
          body: { code },
        })
      ).status,
    ).toBe(401);
  });

  it("refuses an email verified by another account, also when it is taken after the code was sent", async () => {
    await customer("taken@example.com");
    const { token } = await customer("me@example.com");
    const taken = await errorOf(
      await call(changeEmail, "/me/change-email", {
        method: "POST",
        token,
        body: { currentPassword: PASSWORD, newEmail: "taken@example.com" },
      }),
      409,
    );
    expect(taken.details).toEqual({ field: "email" });

    await data(
      await call(changeEmail, "/me/change-email", {
        method: "POST",
        token,
        body: { currentPassword: PASSWORD, newEmail: "late@example.com" },
      }),
      202,
    );
    const code = await mailedCode("late@example.com");
    await customer("late@example.com");
    const raced = await errorOf(
      await call(verifyEmailChange, "/me/change-email/verify", {
        method: "POST",
        token,
        body: { code },
      }),
      409,
    );
    expect(raced.details).toEqual({ field: "email" });
  });
});

describe("phone change (Q153, R30)", () => {
  it("sends the code to the account email and switches the phone", async () => {
    const { customer: profile, token } = await customer("p@example.com", "+201012345678");
    const sent = await data(
      await call(changePhone, "/me/change-phone", {
        method: "POST",
        token,
        body: { currentPassword: PASSWORD, newPhone: "0155 123 4567" },
      }),
      202,
    );
    expect(sent.codeSent).toBe(true);
    const code = await mailedCode("p@example.com");
    const changed = await data(
      await call(verifyPhoneChange, "/me/change-phone/verify", {
        method: "POST",
        token,
        body: { code },
      }),
    );
    expect(changed.customer.phone).toBe("+201551234567");
    expect((await mailsTo("p@example.com"))[0]).toContain("phone number of your BeautyFits");
    const audit = await db.auditLog.findFirstOrThrow({
      where: { action: "CUSTOMER_PHONE_CHANGED" },
    });
    expect(audit).toMatchObject({
      actorId: profile.id,
      previousDataJson: { phone: "+201012345678" },
      newDataJson: { phone: "+201551234567" },
    });
  });

  it("refuses a phone verified by another account and an invalid number", async () => {
    await customer("a@example.com", "+201099999999");
    const { token } = await customer("b@example.com", "+201088888888");
    const taken = await errorOf(
      await call(changePhone, "/me/change-phone", {
        method: "POST",
        token,
        body: { currentPassword: PASSWORD, newPhone: "01099999999" },
      }),
      409,
    );
    expect(taken.details).toEqual({ field: "phone" });
    const invalid = await errorOf(
      await call(changePhone, "/me/change-phone", {
        method: "POST",
        token,
        body: { currentPassword: PASSWORD, newPhone: "0223456789" },
      }),
      400,
    );
    expect(invalid.details.issues[0].code).toBe("phone_invalid");
  });

  it("counts wrong passwords toward the R24 lock", async () => {
    const { token } = await customer();
    for (let i = 0; i < 5; i += 1) {
      await errorOf(
        await call(changePhone, "/me/change-phone", {
          method: "POST",
          token,
          body: { currentPassword: "wrong password", newPhone: "01212345678" },
        }),
        401,
      );
    }
    const locked = await errorOf(
      await call(changePhone, "/me/change-phone", {
        method: "POST",
        token,
        body: { currentPassword: PASSWORD, newPhone: "01212345678" },
      }),
      429,
    );
    expect(locked.code).toBe("AUTH_RATE_LIMITED");
  });
});

describe("locations (R32)", () => {
  it("lists the 27 governorates and lets SHIPPING_MANAGE maintain areas", async () => {
    const list = await data(
      await call(publicLocations, "/locations", { headers: { "accept-language": "en" } }),
    );
    expect(list).toHaveLength(27);
    expect(list[0]).toMatchObject({ code: "C", name: "Cairo", areas: [] });

    const viewer = await staff("MANAGER", ["SHIPPING_VIEW"]);
    const manager = await staff("ADMIN", ["SHIPPING_VIEW", "SHIPPING_MANAGE"]);
    const cairo = await governorate("C");
    const body = { nameAr: "مدينة نصر", nameEn: "Nasr City" };
    const params = { id: cairo.id };
    expect(
      (await call(createArea, "/x", { method: "POST", token: viewer.token, body, params })).status,
    ).toBe(403);
    const created = await data(
      await call(createArea, "/x", { method: "POST", token: manager.token, body, params }),
      201,
    );
    expect(created).toMatchObject({ governorateId: cairo.id, status: "ACTIVE", ...body });
    const duplicate = await errorOf(
      await call(createArea, "/x", {
        method: "POST",
        token: manager.token,
        body: { nameAr: "مدينة نصر", nameEn: "Nasr City 2" },
        params,
      }),
      409,
    );
    expect(duplicate.details.reason).toBe("NAME_TAKEN");

    const arabic = await data(await call(publicLocations, "/locations"));
    expect(arabic[0]).toMatchObject({
      name: "القاهرة",
      areas: [{ id: created.id, name: "مدينة نصر" }],
    });

    await data(
      await call(patchArea, "/x", {
        method: "PATCH",
        token: manager.token,
        body: { status: "INACTIVE" },
        params: { id: created.id },
      }),
    );
    expect((await data(await call(publicLocations, "/locations")))[0].areas).toEqual([]);

    await data(
      await call(patchGovernorate, "/x", {
        method: "PATCH",
        token: manager.token,
        body: { status: "INACTIVE" },
        params: { id: cairo.id },
      }),
    );
    expect(await data(await call(publicLocations, "/locations"))).toHaveLength(26);

    const admin = await data(
      await call(adminLocations, "/admin/locations", { token: viewer.token }),
    );
    expect(admin[0]).toMatchObject({
      code: "C",
      status: "INACTIVE",
      areas: [{ id: created.id, status: "INACTIVE" }],
    });
    const actions = await db.auditLog.findMany({ select: { action: true } });
    expect(actions.map((a) => a.action).sort()).toEqual([
      "AREA_CREATED",
      "AREA_UPDATED",
      "GOVERNORATE_UPDATED",
    ]);
  });
});

describe("addresses (Q45, R32)", () => {
  it("creates, lists, edits, sets the default and deletes", async () => {
    const { token } = await customer();
    const nasr = await area();
    const maadi = await area("C", "Maadi", "المعادي");

    const first = await data(
      await call(createAddress, "/me/addresses", {
        method: "POST",
        token,
        headers: { "accept-language": "en" },
        body: addressBody(nasr.id, { label: "Home", building: "" }),
      }),
      201,
    );
    expect(first).toMatchObject({
      label: "Home",
      phone: "+201112345678",
      building: null,
      isDefault: true,
      governorate: { code: "C", name: "Cairo", active: true },
      area: { id: nasr.id, name: "Nasr City", active: true },
    });
    const second = await data(
      await call(createAddress, "/me/addresses", {
        method: "POST",
        token,
        body: addressBody(maadi.id),
      }),
      201,
    );
    expect(second.isDefault).toBe(false);

    const edited = await data(
      await call(patchAddress, "/x", {
        method: "PATCH",
        token,
        body: { street: "9 Road 9", label: null },
        params: { addressId: second.id },
      }),
    );
    expect(edited).toMatchObject({ street: "9 Road 9", label: null, area: { id: maadi.id } });

    await data(
      await call(setDefault, "/x", { method: "POST", token, params: { addressId: second.id } }),
    );
    const listed = await data(await call(listAddresses, "/me/addresses", { token }));
    expect(listed.map((a: { id: string; isDefault: boolean }) => [a.id, a.isDefault])).toEqual([
      [second.id, true],
      [first.id, false],
    ]);

    // Deleting the default promotes the remaining address.
    await data(
      await call(deleteAddress, "/x", {
        method: "DELETE",
        token,
        params: { addressId: second.id },
      }),
      204,
    );
    const remaining = await data(await call(listAddresses, "/me/addresses", { token }));
    expect(remaining).toMatchObject([{ id: first.id, isDefault: true }]);
  });

  it("keeps addresses private to their customer", async () => {
    const owner = await customer();
    const other = await customer();
    const nasr = await area();
    const address = await data(
      await call(createAddress, "/me/addresses", {
        method: "POST",
        token: owner.token,
        body: addressBody(nasr.id),
      }),
      201,
    );
    const params = { addressId: address.id };
    const token = other.token;
    expect(
      (await call(patchAddress, "/x", { method: "PATCH", token, body: { street: "x" }, params }))
        .status,
    ).toBe(404);
    expect((await call(deleteAddress, "/x", { method: "DELETE", token, params })).status).toBe(404);
    expect((await call(setDefault, "/x", { method: "POST", token, params })).status).toBe(404);
    expect(await data(await call(listAddresses, "/me/addresses", { token }))).toEqual([]);
    expect(
      (
        await call(deleteAddress, "/x", {
          method: "DELETE",
          token,
          params: { addressId: UNKNOWN_ID },
        })
      ).status,
    ).toBe(404);
  });

  it("needs an active area and keeps an area deactivated later", async () => {
    const { token } = await customer();
    const nasr = await area();
    const unknown = await errorOf(
      await call(createAddress, "/me/addresses", {
        method: "POST",
        token,
        body: addressBody(UNKNOWN_ID),
      }),
      400,
    );
    expect(unknown.details.issues[0]).toMatchObject({ path: "areaId", code: "area_not_found" });

    const address = await data(
      await call(createAddress, "/me/addresses", {
        method: "POST",
        token,
        body: addressBody(nasr.id),
      }),
      201,
    );
    await db.area.update({ where: { id: nasr.id }, data: { status: "INACTIVE" } });
    const inactive = await errorOf(
      await call(createAddress, "/me/addresses", {
        method: "POST",
        token,
        body: addressBody(nasr.id),
      }),
      400,
    );
    expect(inactive.details.issues[0].code).toBe("area_inactive");

    const kept = await data(
      await call(patchAddress, "/x", {
        method: "PATCH",
        token,
        body: { areaId: nasr.id, notes: "Ring twice" },
        params: { addressId: address.id },
      }),
    );
    expect(kept).toMatchObject({ notes: "Ring twice", area: { id: nasr.id, active: false } });

    // A governorate that is switched off makes its areas unusable too.
    const alex = await area("ALX", "Smouha", "سموحة");
    await db.governorate.update({ where: { code: "ALX" }, data: { status: "INACTIVE" } });
    const offGov = await errorOf(
      await call(patchAddress, "/x", {
        method: "PATCH",
        token,
        body: { areaId: alex.id },
        params: { addressId: address.id },
      }),
      400,
    );
    expect(offGov.details.issues[0].code).toBe("area_inactive");
  });

  it(`stops at ${MAX_ADDRESSES} addresses`, async () => {
    const { customer: profile, token } = await customer();
    const nasr = await area();
    await db.customerAddress.createMany({
      data: Array.from({ length: MAX_ADDRESSES }, (_, i) => ({
        customerId: profile.id,
        recipientName: "Mona",
        phone: "+201112345678",
        areaId: nasr.id,
        street: `Street ${i}`,
        isDefault: i === 0,
      })),
    });
    const error = await errorOf(
      await call(createAddress, "/me/addresses", {
        method: "POST",
        token,
        body: addressBody(nasr.id),
      }),
      409,
    );
    expect(error.details).toMatchObject({ reason: "ADDRESS_LIMIT_REACHED", limit: MAX_ADDRESSES });
  });
});

describe("deactivation (Q154, R34)", () => {
  it("is refused while an order is open", async () => {
    const { customer: profile, token } = await customer("busy@example.com", "+201013131313");
    const orderId = await bareOrder(profile.id);
    const refused = await errorOf(
      await call(deactivate, "/me/deactivate", {
        method: "POST",
        token,
        body: { currentPassword: PASSWORD },
      }),
      409,
    );
    expect(refused.details).toEqual({
      reason: "ACCOUNT_HAS_OPEN_ITEMS",
      openItems: ["OPEN_ORDER"],
    });

    await db.order.update({ where: { id: orderId }, data: { status: "DELIVERED" } });
    await data(
      await call(deactivate, "/me/deactivate", {
        method: "POST",
        token,
        body: { currentPassword: PASSWORD },
      }),
      204,
    );
  });

  it("needs the password, then signs out, wipes the profile and frees the email and phone", async () => {
    const {
      account,
      customer: profile,
      token,
    } = await customer("gone@example.com", "+201012121212");
    const nasr = await area();
    await data(
      await call(createAddress, "/me/addresses", {
        method: "POST",
        token,
        body: addressBody(nasr.id),
      }),
      201,
    );
    await db.cart.create({ data: { customerId: profile.id } });

    await errorOf(
      await call(deactivate, "/me/deactivate", {
        method: "POST",
        token,
        body: { currentPassword: "not my password" },
      }),
      401,
    );
    await data(
      await call(deactivate, "/me/deactivate", {
        method: "POST",
        token,
        body: { currentPassword: PASSWORD },
      }),
      204,
    );
    expect((await call(getMe, "/me", { token })).status).toBe(401);

    const after = await db.account.findUniqueOrThrow({
      where: { id: account.id },
      include: { customer: true },
    });
    expect(after).toMatchObject({
      status: "DEACTIVATED",
      email: `deleted-${account.id}@invalid`,
      emailVerifiedAt: null,
    });
    expect(after.deactivatedAt).not.toBeNull();
    expect(after.customer).toMatchObject({
      fullName: "Deleted customer",
      phone: "",
      phoneVerifiedAt: null,
      dateOfBirth: null,
    });
    expect(after.customer?.anonymizedAt).not.toBeNull();
    expect(await db.customerAddress.count({ where: { customerId: profile.id } })).toBe(0);
    expect(await db.cart.count({ where: { customerId: profile.id } })).toBe(0); // R35
    expect(await db.authSession.count({ where: { accountId: account.id, revokedAt: null } })).toBe(
      0,
    );
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: "CUSTOMER_DEACTIVATED" } });
    expect(audit).toMatchObject({ actorId: profile.id, entityId: profile.id, newDataJson: null });

    // The same email and phone can open a new account.
    const again = await call(register, "/auth/register", {
      method: "POST",
      body: {
        email: "gone@example.com",
        password: PASSWORD,
        phone: "01012121212",
        fullName: "Back Again",
      },
    });
    expect(again.status).toBe(201);
  });
});
