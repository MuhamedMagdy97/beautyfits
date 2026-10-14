import { describe, expect, it } from "vitest";
import { canMoveShipment } from "@/server/modules/shipping/shipments";

describe("shipment transitions (R2, User Flows §8.2)", () => {
  it("follows Shipped → Out for Delivery → Delivered one step at a time", () => {
    expect(canMoveShipment("SHIPPED", "OUT_FOR_DELIVERY")).toBe(true);
    expect(canMoveShipment("OUT_FOR_DELIVERY", "DELIVERED")).toBe(true);
    expect(canMoveShipment("SHIPPED", "DELIVERED")).toBe(false);
    expect(canMoveShipment("OUT_FOR_DELIVERY", "SHIPPED")).toBe(false);
    expect(canMoveShipment("DELIVERED", "OUT_FOR_DELIVERY")).toBe(false);
  });

  it("records a failed attempt from Out for Delivery and allows another attempt (Q128, Q129)", () => {
    expect(canMoveShipment("OUT_FOR_DELIVERY", "DELIVERY_FAILED")).toBe(true);
    expect(canMoveShipment("DELIVERY_FAILED", "OUT_FOR_DELIVERY")).toBe(true);
    expect(canMoveShipment("SHIPPED", "DELIVERY_FAILED")).toBe(false);
    expect(canMoveShipment("DELIVERY_FAILED", "DELIVERED")).toBe(false);
    expect(canMoveShipment("DELIVERY_FAILED", "DELIVERY_FAILED")).toBe(false);
  });
});
