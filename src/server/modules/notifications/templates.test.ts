import { describe, expect, it } from "vitest";
import {
  NOTIFICATION_TEMPLATES,
  TEMPLATE_KEYS,
  codConfirmationLink,
  eligibleChannels,
  isTemplateKey,
} from "@/server/modules/notifications/templates";

describe("notification templates", () => {
  it("render in both languages with the order number (R14)", () => {
    for (const key of TEMPLATE_KEYS) {
      for (const locale of ["ar", "en"] as const) {
        const message = NOTIFICATION_TEMPLATES[key].render(locale, {
          orderNumber: "BF-1001",
          link: "https://x.test/l",
        });
        expect(message.title, key).not.toBe("");
        expect(message.text, key).toContain("BF-1001");
      }
    }
  });

  it("puts the COD link only in the WhatsApp-only COD messages (R39)", () => {
    for (const key of TEMPLATE_KEYS) {
      const template = NOTIFICATION_TEMPLATES[key];
      const text = template.render("en", { orderNumber: "BF-1", link: "https://x.test/l" }).text;
      expect(text.includes("https://x.test/l"), key).toBe(template.codLink);
      if (template.codLink) {
        expect(template.channels, key).toEqual(["WHATSAPP"]);
        expect(template.inApp, key).toBe(false);
      } else {
        expect(template.channels, key).toEqual(["WHATSAPP", "EMAIL"]);
      }
    }
  });

  it("knows only its own event types", () => {
    expect(isTemplateKey("ORDER_CREATED")).toBe(true);
    expect(isTemplateKey("toString")).toBe(false);
    expect(isTemplateKey("PURCHASE_RECEIVED")).toBe(false);
  });

  it("keeps the link token in the URL fragment", () => {
    expect(codConfirmationLink("https://shop.test", "o1", "bfo_abc")).toBe(
      "https://shop.test/orders/o1/confirm-cod#token=bfo_abc",
    );
  });
});

describe("eligibleChannels (Q61: fallback only to an authorized channel)", () => {
  const template = NOTIFICATION_TEMPLATES.ORDER_CREATED;

  it("tries WhatsApp first, then email", () => {
    expect(eligibleChannels(template, { phone: "+201000000001", email: "a@b.co" })).toEqual([
      { channel: "WHATSAPP", recipient: "+201000000001" },
      { channel: "EMAIL", recipient: "a@b.co" },
    ]);
  });

  it("skips a channel without an authorized address", () => {
    expect(eligibleChannels(template, { phone: "+201000000001", email: null })).toEqual([
      { channel: "WHATSAPP", recipient: "+201000000001" },
    ]);
    expect(eligibleChannels(template, { phone: null, email: "a@b.co" })).toEqual([
      { channel: "EMAIL", recipient: "a@b.co" },
    ]);
  });

  it("never falls back to email for the COD link", () => {
    expect(
      eligibleChannels(NOTIFICATION_TEMPLATES.COD_CONFIRMATION_REMINDER, {
        phone: null,
        email: "a@b.co",
      }),
    ).toEqual([]);
  });
});
