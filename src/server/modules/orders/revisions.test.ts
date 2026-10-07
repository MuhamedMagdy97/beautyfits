import { describe, expect, it } from "vitest";
import {
  canonicalJson,
  effectiveRevisionStatus,
  planLines,
} from "@/server/modules/orders/revisions";

/** Revised order lines (C5, R40). */

const A = "variant-a";
const B = "variant-b";
const today = new Map<string, bigint | null>([
  [A, BigInt(120)],
  [B, BigInt(50)],
]);

describe("planLines", () => {
  it("keeps the order price for quantity already ordered", () => {
    const held = [{ variantId: A, unitPrice: BigInt(100), quantity: 3 }];
    expect(planLines(held, [{ variantId: A, quantity: 2 }], today)).toEqual({
      ok: true,
      lines: [{ variantId: A, unitPrice: BigInt(100), quantity: 2, fromOrder: true }],
    });
  });

  it("prices extra quantity and new items at today's price", () => {
    const held = [{ variantId: A, unitPrice: BigInt(100), quantity: 2 }];
    const result = planLines(
      held,
      [
        { variantId: A, quantity: 3 },
        { variantId: B, quantity: 1 },
      ],
      today,
    );
    expect(result).toEqual({
      ok: true,
      lines: [
        { variantId: A, unitPrice: BigInt(100), quantity: 2, fromOrder: true },
        { variantId: A, unitPrice: BigInt(120), quantity: 1, fromOrder: false },
        { variantId: B, unitPrice: BigInt(50), quantity: 1, fromOrder: false },
      ],
    });
  });

  it("merges extra quantity into a held line with today's price", () => {
    const held = [{ variantId: A, unitPrice: BigInt(120), quantity: 1 }];
    expect(planLines(held, [{ variantId: A, quantity: 4 }], today)).toEqual({
      ok: true,
      lines: [{ variantId: A, unitPrice: BigInt(120), quantity: 4, fromOrder: true }],
    });
  });

  it("drops removed variants and keeps the cheapest held price first", () => {
    const held = [
      { variantId: A, unitPrice: BigInt(120), quantity: 1 },
      { variantId: A, unitPrice: BigInt(100), quantity: 1 },
      { variantId: B, unitPrice: BigInt(50), quantity: 2 },
    ];
    expect(planLines(held, [{ variantId: A, quantity: 1 }], today)).toEqual({
      ok: true,
      lines: [{ variantId: A, unitPrice: BigInt(100), quantity: 1, fromOrder: true }],
    });
  });

  it("refuses extra quantity of an item that cannot be bought now", () => {
    const held = [{ variantId: A, unitPrice: BigInt(100), quantity: 1 }];
    const gone = new Map<string, bigint | null>([[A, null]]);
    expect(planLines(held, [{ variantId: A, quantity: 1 }], gone).ok).toBe(true);
    expect(planLines(held, [{ variantId: A, quantity: 2 }], gone)).toEqual({
      ok: false,
      unavailable: [A],
    });
  });
});

describe("effectiveRevisionStatus", () => {
  const now = new Date("2026-10-07T12:00:00Z");
  const open = { status: "PENDING_CONFIRMATION" as const, expiresAt: new Date(now.getTime() + 1) };

  it("is pending while open and the order editable", () => {
    expect(effectiveRevisionStatus(open, "CONFIRMED", now)).toBe("PENDING_CONFIRMATION");
  });

  it("shows EXPIRED once lapsed or once the order is being prepared", () => {
    expect(effectiveRevisionStatus({ ...open, expiresAt: now }, "NEW", now)).toBe("EXPIRED");
    expect(effectiveRevisionStatus(open, "PREPARING", now)).toBe("EXPIRED");
    expect(effectiveRevisionStatus({ ...open, status: "CONFIRMED" }, "PREPARING", now)).toBe(
      "CONFIRMED",
    );
  });
});

describe("canonicalJson", () => {
  it("ignores key order", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [3] } })).toBe(
      canonicalJson({ a: { c: [3], d: 2 }, b: 1 }),
    );
  });
});
