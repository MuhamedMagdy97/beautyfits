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
});
