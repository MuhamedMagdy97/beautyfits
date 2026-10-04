import { percentOf } from "@/server/money/money";

/**
 * Discount eligibility and amount (TASK-026, Business Spec Q125, Q131–Q138,
 * R9, R36, ADR-0032). Pure: callers load the rule, the cart lines and the
 * usage counts.
 *
 * - The percentage applies to the targeted purchasable lines only; a store-
 *   wide discount targets every purchasable line. Unavailable lines never
 *   count (Q137).
 * - The minimum order total is compared with the whole cart subtotal
 *   (purchasable lines).
 * - The amount is computed once on the targeted subtotal, HALF-UP (R9), then
 *   capped by the maximum discount amount.
 * - A per-customer limit needs a signed-in customer (R36).
 */

export interface DiscountRule {
  status: "ACTIVE" | "INACTIVE";
  value: number;
  scope: "STORE_WIDE" | "TARGETED";
  maxDiscountAmount: bigint | null;
  minimumOrderTotal: bigint | null;
  startsAt: Date;
  endsAt: Date | null;
  usageLimitTotal: number | null;
  usageLimitPerCustomer: number | null;
  productIds: ReadonlySet<string>;
  /** Targeted categories and all their subcategories (see `withSubcategories`). */
  categoryIds: ReadonlySet<string>;
  brandIds: ReadonlySet<string>;
}

export interface DiscountLine {
  productId: string;
  brandId: string | null;
  categoryIds: readonly string[];
  /** Null when the line cannot be bought now. */
  lineTotal: bigint | null;
}

export interface DiscountUsageCounts {
  total: number;
  /** Uses by this customer; null for a guest. */
  customer: number | null;
}

export type DiscountProblem =
  | "INACTIVE"
  | "NOT_STARTED"
  | "ENDED"
  | "USAGE_LIMIT_REACHED"
  | "SIGN_IN_REQUIRED"
  | "CUSTOMER_LIMIT_REACHED"
  | "NO_ELIGIBLE_ITEMS"
  | "MINIMUM_NOT_MET";

export type DiscountResult =
  { ok: true; amount: bigint; eligibleSubtotal: bigint } | { ok: false; problem: DiscountProblem };

function isTargeted(rule: DiscountRule, line: DiscountLine): boolean {
  return (
    rule.scope === "STORE_WIDE" ||
    rule.productIds.has(line.productId) ||
    (line.brandId !== null && rule.brandIds.has(line.brandId)) ||
    line.categoryIds.some((id) => rule.categoryIds.has(id))
  );
}

export function evaluateDiscount(
  rule: DiscountRule,
  lines: readonly DiscountLine[],
  usage: DiscountUsageCounts,
  now: Date,
): DiscountResult {
  const fail = (problem: DiscountProblem): DiscountResult => ({ ok: false, problem });
  if (rule.status !== "ACTIVE") return fail("INACTIVE");
  if (now < rule.startsAt) return fail("NOT_STARTED");
  if (rule.endsAt !== null && now >= rule.endsAt) return fail("ENDED");
  if (rule.usageLimitTotal !== null && usage.total >= rule.usageLimitTotal) {
    return fail("USAGE_LIMIT_REACHED");
  }
  if (rule.usageLimitPerCustomer !== null) {
    if (usage.customer === null) return fail("SIGN_IN_REQUIRED");
    if (usage.customer >= rule.usageLimitPerCustomer) return fail("CUSTOMER_LIMIT_REACHED");
  }

  let subtotal = BigInt(0);
  let eligibleSubtotal = BigInt(0);
  let anyEligible = false;
  for (const line of lines) {
    if (line.lineTotal === null) continue;
    subtotal += line.lineTotal;
    if (isTargeted(rule, line)) {
      eligibleSubtotal += line.lineTotal;
      anyEligible = true;
    }
  }
  if (!anyEligible) return fail("NO_ELIGIBLE_ITEMS");
  if (rule.minimumOrderTotal !== null && subtotal < rule.minimumOrderTotal) {
    return fail("MINIMUM_NOT_MET");
  }

  const raw = percentOf(eligibleSubtotal, rule.value);
  const amount =
    rule.maxDiscountAmount !== null && raw > rule.maxDiscountAmount ? rule.maxDiscountAmount : raw;
  return { ok: true, amount, eligibleSubtotal };
}

/** The given categories plus every category below them (R36). */
export function withSubcategories(
  targetIds: Iterable<string>,
  categories: readonly { id: string; parentId: string | null }[],
): Set<string> {
  const children = new Map<string, string[]>();
  for (const { id, parentId } of categories) {
    if (parentId !== null) {
      children.set(parentId, [...(children.get(parentId) ?? []), id]);
    }
  }
  const result = new Set<string>();
  const queue = [...targetIds];
  while (queue.length > 0) {
    const id = queue.pop()!;
    if (!result.has(id)) {
      result.add(id);
      queue.push(...(children.get(id) ?? []));
    }
  }
  return result;
}
