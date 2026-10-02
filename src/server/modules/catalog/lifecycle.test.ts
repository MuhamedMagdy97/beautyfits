import { describe, expect, it } from "vitest";
import type { ProductStatus } from "@/generated/prisma/client";
import {
  checkPublishable,
  type ProductTransition,
  transitionOutcome,
  unnamedVariantIds,
} from "@/server/modules/catalog/lifecycle";

describe("transitionOutcome", () => {
  // Rows: current status; columns: publish, unpublish, disable, archive (ADR-0022 §1).
  const table: Record<ProductStatus, Record<ProductTransition, string>> = {
    DRAFT: { publish: "change", unpublish: "repeat", disable: "refused", archive: "change" },
    PUBLISHED: { publish: "repeat", unpublish: "change", disable: "change", archive: "change" },
    DISABLED: { publish: "change", unpublish: "change", disable: "repeat", archive: "change" },
    ARCHIVED: { publish: "refused", unpublish: "refused", disable: "refused", archive: "repeat" },
  };

  for (const [from, row] of Object.entries(table)) {
    for (const [transition, expected] of Object.entries(row)) {
      it(`${transition} from ${from} is ${expected}`, () => {
        expect(transitionOutcome(from as ProductStatus, transition as ProductTransition)).toBe(
          expected,
        );
      });
    }
  }
});

describe("publish requirements", () => {
  const PRICE = BigInt(19_999);
  const named = (id: string) => ({ id, nameAr: "وردي", nameEn: "Rose", sellingPrice: PRICE });
  const unnamed = (id: string) => ({ id, nameAr: null, nameEn: null, sellingPrice: PRICE });

  it("accepts a product with a main image and one unnamed variant", () => {
    expect(checkPublishable({ hasMainImage: true, activeVariants: [unnamed("a")] })).toEqual({
      missing: [],
      unnamedVariantIds: [],
      unpricedVariantIds: [],
    });
  });

  it("needs a main image", () => {
    expect(checkPublishable({ hasMainImage: false, activeVariants: [named("a")] }).missing).toEqual(
      ["MAIN_IMAGE"],
    );
  });

  it("needs names on every active variant when there are several, and lists all gaps", () => {
    expect(
      checkPublishable({
        hasMainImage: false,
        activeVariants: [unnamed("a"), named("b"), unnamed("c")],
      }),
    ).toEqual({
      missing: ["MAIN_IMAGE", "VARIANT_NAMES"],
      unnamedVariantIds: ["a", "c"],
      unpricedVariantIds: [],
    });
  });

  it("needs a selling price on every active variant (ADR-0023)", () => {
    expect(
      checkPublishable({
        hasMainImage: true,
        activeVariants: [named("a"), { ...named("b"), sellingPrice: null }],
      }),
    ).toEqual({ missing: ["SELLING_PRICE"], unnamedVariantIds: [], unpricedVariantIds: ["b"] });
  });

  it("treats a half-named variant as unnamed", () => {
    expect(unnamedVariantIds([named("a"), { ...named("b"), nameEn: null }])).toEqual(["b"]);
  });
});
