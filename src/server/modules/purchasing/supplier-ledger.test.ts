import { describe, expect, it } from "vitest";
import {
  createSupplierReturnSchema,
  recordSupplierPaymentSchema,
  settleSupplierReturnSchema,
} from "@/server/modules/purchasing/schemas";
import { paymentStatus, signedAmount } from "@/server/modules/purchasing/supplier-ledger";

/** Supplier ledger rules (TASK-024, Q118, Q119, ADR-0029). */

const n = (value: number) => BigInt(value);

describe("supplier ledger", () => {
  it("signs entries by direction: CREDIT raises what we owe, DEBIT lowers it", () => {
    expect(signedAmount("CREDIT", n(500))).toBe(n(500));
    expect(signedAmount("DEBIT", n(500))).toBe(n(-500));
  });

  it("derives Paid / Partially Paid / Unpaid per purchase order (Q118)", () => {
    expect(paymentStatus(n(1000), n(0))).toBe("UNPAID");
    expect(paymentStatus(n(400), n(600))).toBe("PARTIALLY_PAID");
    expect(paymentStatus(n(0), n(1000))).toBe("PAID");
    // Overpaid, or everything credited back.
    expect(paymentStatus(n(-100), n(1100))).toBe("PAID");
    expect(paymentStatus(n(0), n(0))).toBe("PAID");
  });
});

describe("supplier finance schemas", () => {
  it("validates payments as integer piastres", () => {
    const base = { amount: 50_000, method: "CASH", paidOn: "2026-10-03" };
    expect(recordSupplierPaymentSchema.parse(base).amount).toBe(n(50_000));
    expect(recordSupplierPaymentSchema.safeParse({ ...base, amount: 0 }).success).toBe(false);
    expect(recordSupplierPaymentSchema.safeParse({ ...base, amount: 1.5 }).success).toBe(false);
    expect(recordSupplierPaymentSchema.safeParse({ ...base, method: "CARD" }).success).toBe(false);
    expect(recordSupplierPaymentSchema.safeParse({ ...base, paidOn: "03/10/2026" }).success).toBe(
      false,
    );
  });

  it("validates settlements and return lines", () => {
    expect(settleSupplierReturnSchema.safeParse({ resolution: "CREDIT" }).success).toBe(true);
    expect(settleSupplierReturnSchema.safeParse({ resolution: "SWAP" }).success).toBe(false);
    expect(settleSupplierReturnSchema.safeParse({ resolution: "REFUND", amount: 0 }).success).toBe(
      false,
    );
    const line = { goodsReceiptItemId: "0199a8d0-0000-7000-8000-000000000001", quantity: 1 };
    expect(createSupplierReturnSchema.safeParse({ reason: "x", items: [line] }).success).toBe(true);
    expect(createSupplierReturnSchema.safeParse({ reason: "x", items: [line, line] }).success).toBe(
      false,
    );
    expect(createSupplierReturnSchema.safeParse({ reason: "", items: [line] }).success).toBe(false);
  });
});
