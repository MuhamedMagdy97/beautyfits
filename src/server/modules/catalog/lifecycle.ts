import type { ProductStatus } from "@/generated/prisma/client";

/**
 * The product lifecycle (TASK-017, User Flows §4.1, ADR-0022): which status
 * changes are allowed and what a product needs before customers can see it.
 * Pure rules; `products-service.ts` applies them inside transactions.
 *
 * - Draft is the starting state; publish makes the product visible.
 * - Disabled is a pause: hidden, still editable, can be published again.
 * - Archived is final in v1: read-only, kept for order history.
 */

export type ProductTransition = "publish" | "unpublish" | "disable" | "archive";

/** The status each transition leads to. */
export const TRANSITION_TARGET: Record<ProductTransition, ProductStatus> = {
  publish: "PUBLISHED",
  unpublish: "DRAFT",
  disable: "DISABLED",
  archive: "ARCHIVED",
};

/** The statuses each transition may start from (besides its own target). */
const ALLOWED_FROM: Record<ProductTransition, readonly ProductStatus[]> = {
  publish: ["DRAFT", "DISABLED"],
  unpublish: ["PUBLISHED", "DISABLED"],
  // A draft is already invisible, so only a published product is disabled.
  disable: ["PUBLISHED"],
  archive: ["DRAFT", "PUBLISHED", "DISABLED"],
};

/**
 * What applying `transition` to a product in status `from` does: `change` to
 * the target status, `repeat` when the product already has it (no-op), or
 * `refused`.
 */
export function transitionOutcome(
  from: ProductStatus,
  transition: ProductTransition,
): "change" | "repeat" | "refused" {
  if (from === TRANSITION_TARGET[transition]) {
    return "repeat";
  }
  return ALLOWED_FROM[transition].includes(from) ? "change" : "refused";
}

export type PublishRequirement = "MAIN_IMAGE" | "VARIANT_NAMES";

export interface PublishFacts {
  hasMainImage: boolean;
  activeVariants: { id: string; nameAr: string | null; nameEn: string | null }[];
}

export interface PublishCheck {
  missing: PublishRequirement[];
  unnamedVariantIds: string[];
}

/**
 * Active variants customers could not tell apart: with more than one active
 * variant, every one needs its name (ADR-0022 §2).
 */
export function unnamedVariantIds(activeVariants: PublishFacts["activeVariants"]): string[] {
  if (activeVariants.length <= 1) {
    return [];
  }
  return activeVariants
    .filter((variant) => variant.nameAr === null || variant.nameEn === null)
    .map((variant) => variant.id);
}

/** The unmet publish requirements (Q178, ADR-0022 §2); empty when publishable. */
export function checkPublishable(facts: PublishFacts): PublishCheck {
  const missing: PublishRequirement[] = [];
  if (!facts.hasMainImage) {
    missing.push("MAIN_IMAGE");
  }
  const unnamed = unnamedVariantIds(facts.activeVariants);
  if (unnamed.length > 0) {
    missing.push("VARIANT_NAMES");
  }
  return { missing, unnamedVariantIds: unnamed };
}
