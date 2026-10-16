import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as freeShippingThreshold } from "@/app/api/v1/shipping/free-shipping-threshold/route";
import { getDb } from "@/server/db/client";
import { createLogger } from "@/server/logging/logger";
import { createScryptHasher } from "@/server/modules/auth/password-hash";
import { runBootstrap } from "@/server/modules/bootstrap/bootstrap";
import {
  runDevLocationsSeed,
  SAMPLE_AREAS,
  SAMPLE_SHIPPING_FEE,
} from "@/server/modules/bootstrap/dev-locations";
import { resetDatabase } from "@/test/integration/database";

/** Development sample areas and shipping rule, and the public free-shipping threshold. */

const db = getDb();
const clock = { now: () => new Date() };
const hasher = createScryptHasher({ N: 1024, r: 8, p: 1, keyLength: 32, saltLength: 16 });
const logger = createLogger({ level: "error", write: () => {} });

beforeAll(async () => {
  await resetDatabase();
  await runBootstrap(
    { db, clock, hasher, logger },
    { owner: { email: "owner@beautyfits.example", password: "saffron harbour under quiet lamps" } },
  );
});

afterAll(async () => {
  await resetDatabase();
});

describe("runDevLocationsSeed", () => {
  it("adds the sample areas and one catch-all rule through the services, once", async () => {
    const expectedAreas = Object.values(SAMPLE_AREAS).flat().length;
    const first = await runDevLocationsSeed({ db, clock, logger }, { nodeEnv: "development" });
    expect(first).toEqual({ areasCreated: expectedAreas, shippingRulesCreated: 1 });
    expect(await db.area.count()).toBe(expectedAreas);
    const rule = await db.shippingRule.findFirstOrThrow();
    expect(rule).toMatchObject({ governorateId: null, areaId: null, status: "ACTIVE" });
    expect(rule.shippingFee).toBe(BigInt(SAMPLE_SHIPPING_FEE));
    expect(await db.auditLog.count({ where: { action: "AREA_CREATED" } })).toBe(expectedAreas);

    const again = await runDevLocationsSeed({ db, clock, logger }, { nodeEnv: "development" });
    expect(again).toEqual({ areasCreated: 0, shippingRulesCreated: 0 });
    expect(await db.shippingRule.count()).toBe(1);
  });

  it("never runs in production", async () => {
    await expect(
      runDevLocationsSeed({ db, clock, logger }, { nodeEnv: "production" }),
    ).rejects.toThrow(/never runs/);
  });
});

describe("GET /shipping/free-shipping-threshold", () => {
  it("returns the threshold setting in piastres, publicly", async () => {
    const res = await (
      freeShippingThreshold as (r: Request, c: { params: Promise<never> }) => Promise<Response>
    )(new Request("http://localhost/api/v1/shipping/free-shipping-threshold"), {
      params: Promise.resolve({}) as Promise<never>,
    });
    const json = await res.json();
    expect(res.status).toBe(200);
    // Default R37 / Q123: 2,500.00 EGP.
    expect(json.data).toEqual({ freeShippingThreshold: 250000, currency: "EGP" });
  });
});
