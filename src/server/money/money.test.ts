import { describe, expect, it } from "vitest";
import {
  allocate,
  add,
  basisPointsOf,
  compare,
  formatMajor,
  minorUnitsSchema,
  multiply,
  multiplyRatio,
  parseMajor,
  percentOf,
  roundHalfUp,
  subtract,
  toJsonNumber,
  toMinor,
} from "@/server/money/money";

const b = (value: number) => BigInt(value);

describe("toMinor", () => {
  it("accepts integer minor units", () => {
    expect(toMinor(19999)).toBe(b(19999));
    expect(toMinor(b(-5))).toBe(b(-5));
    expect(toMinor("123")).toBe(b(123));
    expect(toMinor("-7")).toBe(b(-7));
  });

  it("rejects floats, NaN, Infinity and unsafe integers", () => {
    for (const bad of [199.99, 0.1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => toMinor(bad), String(bad)).toThrow(RangeError);
    }
    for (const bad of ["1.5", "", "1e3", " 12", "abc"]) {
      expect(() => toMinor(bad), bad).toThrow(RangeError);
    }
  });
});

describe("toJsonNumber", () => {
  it("returns a safe integer number", () => {
    expect(toJsonNumber(b(19999))).toBe(19999);
  });

  it("refuses values JSON cannot carry exactly", () => {
    expect(() => toJsonNumber(BigInt(Number.MAX_SAFE_INTEGER) + b(1))).toThrow(RangeError);
  });
});

describe("minorUnitsSchema", () => {
  it("parses integers to bigint and rejects fractional amounts", () => {
    expect(minorUnitsSchema.parse(150)).toBe(b(150));
    expect(minorUnitsSchema.safeParse(1.5).success).toBe(false);
    expect(minorUnitsSchema.safeParse("150").success).toBe(false);
  });
});

describe("arithmetic", () => {
  it("adds, subtracts, multiplies and compares exactly", () => {
    expect(add(b(10), b(20), b(-5))).toBe(b(25));
    expect(add()).toBe(b(0));
    expect(subtract(b(100), b(250))).toBe(b(-150));
    expect(multiply(b(19999), 3)).toBe(b(59997));
    expect(() => multiply(b(1), 1.5)).toThrow(RangeError);
    expect(compare(b(1), b(2))).toBe(-1);
    expect(compare(b(2), b(2))).toBe(0);
    expect(compare(b(3), b(2))).toBe(1);
  });

  it("does not lose precision where floats would", () => {
    // 0.1 + 0.2 EGP in floats is 0.30000000000000004.
    expect(add(parseMajor("0.10"), parseMajor("0.20"))).toBe(parseMajor("0.30"));
  });
});

describe("roundHalfUp (R9, R22)", () => {
  it.each([
    [5, 2, 3], // 2.5 → 3
    [-5, 2, -3], // -2.5 → -3 (ties away from zero)
    [7, 2, 4], // 3.5 → 4
    [-7, 2, -4],
    [149, 100, 1], // 1.49 → 1
    [150, 100, 2], // 1.50 → 2
    [-149, 100, -1],
    [-150, 100, -2],
    [1, 3, 0],
    [2, 3, 1],
    [-2, 3, -1],
    [5, -2, -3], // sign carried by the denominator
    [-5, -2, 3],
    [0, 7, 0],
  ])("%i / %i → %i", (numerator, denominator, expected) => {
    expect(roundHalfUp(b(numerator), b(denominator))).toBe(b(expected));
  });

  it("rejects a zero denominator", () => {
    expect(() => roundHalfUp(b(1), b(0))).toThrow(RangeError);
  });
});

describe("derived amounts", () => {
  it("rounds a 25% partial refund HALF-UP at the .5 piastre boundary (R7, R9)", () => {
    expect(percentOf(b(1999), "25")).toBe(b(500)); // 499.75 → 500
    expect(percentOf(b(1998), 25)).toBe(b(500)); // 499.50 → 500
    expect(percentOf(b(1997), "25")).toBe(b(499)); // 499.25 → 499
  });

  it("handles decimal percentages exactly", () => {
    expect(percentOf(b(10001), "12.5")).toBe(b(1250)); // 1250.125 → 1250
    expect(percentOf(b(1004), "12.5")).toBe(b(126)); // 125.5 → 126
    expect(percentOf(b(1000), "14")).toBe(b(140));
    expect(percentOf(b(-1004), "12.5")).toBe(b(-126));
  });

  it("rejects non-decimal percentages", () => {
    expect(() => percentOf(b(100), "12,5")).toThrow(RangeError);
    expect(() => percentOf(b(100), 12.5)).toThrow(RangeError);
  });

  it("computes basis points and ratios", () => {
    expect(basisPointsOf(b(1000), 1450)).toBe(b(145)); // 14.5%
    expect(basisPointsOf(b(3), 5000)).toBe(b(2)); // 1.5 → 2
    // Weighted average cost: (10 × 1000 + 5 × 1201) / 15 = 1067.0 → 1067.
    expect(multiplyRatio(b(10 * 1000 + 5 * 1201), 1, 15)).toBe(b(1067));
    expect(multiplyRatio(b(1), 1, 2)).toBe(b(1));
    expect(() => multiplyRatio(b(1), 1, 0)).toThrow(RangeError);
  });
});

describe("major-unit strings", () => {
  it("parses major units strictly", () => {
    expect(parseMajor("199.99")).toBe(b(19999));
    expect(parseMajor("199.9")).toBe(b(19990));
    expect(parseMajor("5")).toBe(b(500));
    expect(parseMajor("0.05")).toBe(b(5));
    expect(parseMajor("-12.30")).toBe(b(-1230));
    for (const bad of ["1.999", "1,000", "", "abc", "1.", ".5", "1e2"]) {
      expect(() => parseMajor(bad), bad).toThrow(RangeError);
    }
  });

  it("formats minor units as major-unit strings", () => {
    expect(formatMajor(b(19999))).toBe("199.99");
    expect(formatMajor(b(5))).toBe("0.05");
    expect(formatMajor(b(-1230))).toBe("-12.30");
    expect(formatMajor(b(0))).toBe("0.00");
    expect(parseMajor(formatMajor(b(-7)))).toBe(b(-7));
  });
});

describe("allocate", () => {
  it("splits exactly, giving leftovers to the largest remainders", () => {
    expect(allocate(b(100), [b(1), b(1), b(1)])).toEqual([b(34), b(33), b(33)]);
    expect(allocate(b(1000), [b(15000), b(5000)])).toEqual([b(750), b(250)]);
    expect(allocate(b(7), [b(10), b(20), b(30)])).toEqual([b(1), b(2), b(4)]);
    expect(allocate(b(0), [b(5), b(5)])).toEqual([b(0), b(0)]);
    expect(allocate(b(10), [b(0), b(10)])).toEqual([b(0), b(10)]);
  });

  it("never gives a share above its weight when the amount fits", () => {
    const weights = [b(1), b(2), b(3), b(997)];
    const shares = allocate(b(1003), weights);
    expect(shares).toEqual(weights);
    expect(() => allocate(b(1), [])).toThrow(RangeError);
    expect(() => allocate(b(-1), [b(1)])).toThrow(RangeError);
  });
});
