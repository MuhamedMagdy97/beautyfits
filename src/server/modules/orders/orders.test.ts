import { describe, expect, it } from "vitest";
import { canTransition, ORDER_TRANSITIONS } from "@/server/modules/orders/orders";

/** The order state machine (R1–R4, R11, User Flows §8). */
describe("order transitions", () => {
  it("follows the lifecycle one step at a time", () => {
    expect(canTransition("PENDING_CONFIRMATION", "NEW")).toBe(true);
    expect(canTransition("NEW", "CONFIRMED")).toBe(true);
    expect(canTransition("CONFIRMED", "PREPARING")).toBe(true);
    expect(canTransition("PREPARING", "READY_FOR_SHIPMENT")).toBe(true);
    expect(canTransition("READY_FOR_SHIPMENT", "SHIPPED")).toBe(true);
    expect(canTransition("SHIPPED", "DELIVERED")).toBe(true);
  });

  it("rejects jumps, going back and leaving a final status", () => {
    expect(canTransition("PREPARING", "SHIPPED")).toBe(false); // R4
    expect(canTransition("PENDING_CONFIRMATION", "CONFIRMED")).toBe(false);
    expect(canTransition("PREPARING", "NEW")).toBe(false);
    expect(canTransition("NEW", "EXPIRED")).toBe(false);
    for (const final of ["DELIVERED", "CANCELLED", "EXPIRED"] as const) {
      expect(ORDER_TRANSITIONS[final]).toEqual([]);
    }
  });

  it("allows cancelling until shipped, and after shipping only via the return (R3, R11)", () => {
    for (const from of [
      "PENDING_CONFIRMATION",
      "NEW",
      "CONFIRMED",
      "PREPARING",
      "READY_FOR_SHIPMENT",
      "SHIPPED",
    ] as const) {
      expect(canTransition(from, "CANCELLED")).toBe(true);
    }
    expect(canTransition("DELIVERED", "CANCELLED")).toBe(false);
  });
});

describe("revised orders (C5, R40)", () => {
  it("go back from Confirmed to New for another staff review", () => {
    expect(canTransition("CONFIRMED", "NEW")).toBe(true);
  });
});
