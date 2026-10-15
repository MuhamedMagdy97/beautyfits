import { describe, expect, it } from "vitest";
import { formatMoney } from "./format";

describe("formatMoney", () => {
  it("shows piastres as Egyptian pounds, decimals only when needed", () => {
    expect(formatMoney(145000, "en")).toMatch(/1,450(?!\.)/);
    expect(formatMoney(145050, "en")).toMatch(/1,450\.50/);
    expect(formatMoney(145000, "en")).toMatch(/EGP/);
    expect(formatMoney(0, "en")).toMatch(/0/);
  });

  it("uses Arabic digits in Arabic", () => {
    expect(formatMoney(145000, "ar")).toMatch(/١٬?٤٥٠/);
  });
});
