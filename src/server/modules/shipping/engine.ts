/**
 * Shipping fee and free shipping (TASK-027, Business Spec Q121–Q126, R37,
 * ADR-0033). Pure: callers load the active rules of active companies.
 *
 * - A rule matches a place when it names the area, the area's governorate,
 *   or neither (everywhere); and the order total when it lies in
 *   `[minOrderTotal, maxOrderTotal)`; and `now` when it lies in
 *   `[activeFrom, activeTo)`.
 * - The most specific match wins: area, then governorate, then everywhere;
 *   then the higher `priority`, then the lower fee, then the id (stable).
 * - The order total is the total after discounts (Q123, Q124). From the
 *   store-wide threshold on, the fee is 0; a place without a matching rule
 *   still gets no quote (we do not ship there).
 */

export interface ShippingRuleCandidate {
  id: string;
  shippingCompanyId: string | null;
  governorateId: string | null;
  areaId: string | null;
  minOrderTotal: bigint | null;
  maxOrderTotal: bigint | null;
  shippingFee: bigint;
  priority: number;
  activeFrom: Date | null;
  activeTo: Date | null;
}

export interface ShippingQuoteInput {
  governorateId: string;
  areaId: string;
  /** Piastres, after discounts. */
  orderTotal: bigint;
  freeShippingThreshold: bigint;
  now: Date;
}

export interface ShippingQuote {
  rule: ShippingRuleCandidate;
  /** What the customer pays: the rule's fee, or 0 from the threshold. */
  shippingFee: bigint;
  freeShipping: boolean;
}

function specificity(rule: ShippingRuleCandidate): number {
  return rule.areaId ? 2 : rule.governorateId ? 1 : 0;
}

function matches(rule: ShippingRuleCandidate, input: ShippingQuoteInput): boolean {
  const place = rule.areaId
    ? rule.areaId === input.areaId
    : rule.governorateId === null || rule.governorateId === input.governorateId;
  return (
    place &&
    (rule.minOrderTotal === null || input.orderTotal >= rule.minOrderTotal) &&
    (rule.maxOrderTotal === null || input.orderTotal < rule.maxOrderTotal) &&
    (rule.activeFrom === null || input.now >= rule.activeFrom) &&
    (rule.activeTo === null || input.now < rule.activeTo)
  );
}

function compareRules(a: ShippingRuleCandidate, b: ShippingRuleCandidate): number {
  return (
    specificity(b) - specificity(a) ||
    b.priority - a.priority ||
    (a.shippingFee < b.shippingFee ? -1 : a.shippingFee > b.shippingFee ? 1 : 0) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

/** The rule that prices this order and the fee to charge, or null: no shipping here. */
export function quoteShipping(
  rules: readonly ShippingRuleCandidate[],
  input: ShippingQuoteInput,
): ShippingQuote | null {
  const rule = rules.filter((r) => matches(r, input)).sort(compareRules)[0];
  if (!rule) {
    return null;
  }
  const freeShipping = input.orderTotal >= input.freeShippingThreshold;
  return { rule, shippingFee: freeShipping ? BigInt(0) : rule.shippingFee, freeShipping };
}
