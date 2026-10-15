import { describe, expect, it } from "vitest";
import { addressLine, notificationHref, orderActions, snapshotName } from "./account";

describe("orderActions", () => {
  it("offers cancellation up to Ready for Shipment and a delivery stop once shipped (R11)", () => {
    for (const status of [
      "PENDING_CONFIRMATION",
      "NEW",
      "CONFIRMED",
      "PREPARING",
      "READY_FOR_SHIPMENT",
    ]) {
      expect(orderActions(status)).toMatchObject({ cancel: true, stopDelivery: false });
    }
    expect(orderActions("SHIPPED")).toMatchObject({ cancel: false, stopDelivery: true });
    for (const status of ["DELIVERED", "CANCELLED", "EXPIRED"]) {
      expect(orderActions(status)).toMatchObject({ cancel: false, stopDelivery: false });
    }
  });

  it("offers changes before Preparing and returns/reviews only when delivered", () => {
    expect(orderActions("CONFIRMED").modify).toBe(true);
    expect(orderActions("PREPARING").modify).toBe(false);
    expect(orderActions("DELIVERED")).toMatchObject({ modify: false, afterDelivery: true });
    expect(orderActions("SHIPPED").afterDelivery).toBe(false);
  });
});

describe("notificationHref", () => {
  it("links orders and products, nothing else", () => {
    expect(notificationHref({ type: "ORDER", id: "o1" })).toBe("/account/orders/o1");
    expect(notificationHref({ type: "PRODUCT", id: "p1" })).toBe("/products/p1");
    expect(notificationHref({ type: "OTHER", id: "x" })).toBeNull();
    expect(notificationHref(null)).toBeNull();
  });
});

describe("snapshot names", () => {
  it("uses the page language with a fallback", () => {
    expect(snapshotName({ ar: "عطر", en: "Perfume" }, "en")).toBe("Perfume");
    expect(snapshotName({ ar: "عطر", en: null }, "en")).toBe("عطر");
    expect(snapshotName(null, "ar")).toBeNull();
  });

  it("joins the address parts that are present", () => {
    const address = {
      recipientName: "Mona",
      phone: "+201000000000",
      governorate: { nameAr: "القاهرة", nameEn: "Cairo" },
      area: { nameAr: "المعادي", nameEn: "Maadi" },
      city: null,
      street: "9 Road 9",
      building: "4",
      floor: null,
      apartment: null,
      landmark: null,
    };
    expect(addressLine(address, "en")).toBe("9 Road 9, 4, Maadi, Cairo");
    expect(addressLine(address, "ar")).toBe("9 Road 9، 4، المعادي، القاهرة");
  });
});
