/**
 * Form shaping for the discounts, marketing and wallet screens (TASK-056).
 * It only turns what staff typed into request bodies; the API validates and
 * decides everything.
 */
import type { DiscountView } from "@/server/modules/discounts/discounts-service";
import type { SegmentDefinition } from "@/server/modules/customers/segments";
import { optionalInt } from "./forms";
import { formatPiastres, parsePounds } from "./money";

/** ISO time → `datetime-local` value in the browser's time zone. */
export function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** `datetime-local` value → ISO time; blank or unreadable → null. */
export function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** Optional pounds field: "" → null, "25.5" → 2550, anything else → undefined (unreadable). */
function optionalPounds(text: string): number | null | undefined {
  return text.trim() === "" ? null : (parsePounds(text) ?? undefined);
}

export interface DiscountForm {
  code: string;
  nameAr: string;
  nameEn: string;
  value: string;
  scope: "STORE_WIDE" | "TARGETED";
  productIds: string[];
  categoryIds: string[];
  brandIds: string[];
  maxDiscount: string;
  minimumOrder: string;
  startsAt: string;
  endsAt: string;
  usageTotal: string;
  usagePerCustomer: string;
}

export function discountForm(discount?: DiscountView): DiscountForm {
  const pounds = (value: number | null | undefined) => formatPiastres(value) ?? "";
  const count = (value: number | null | undefined) => (value == null ? "" : String(value));
  return {
    code: discount?.code ?? "",
    nameAr: discount?.nameAr ?? "",
    nameEn: discount?.nameEn ?? "",
    value: count(discount?.value),
    scope: discount?.scope ?? "STORE_WIDE",
    productIds: discount?.productIds ?? [],
    categoryIds: discount?.categoryIds ?? [],
    brandIds: discount?.brandIds ?? [],
    maxDiscount: pounds(discount?.maxDiscountAmount),
    minimumOrder: pounds(discount?.minimumOrderTotal),
    startsAt: toLocalInput(discount?.startsAt ?? new Date().toISOString()),
    endsAt: toLocalInput(discount?.endsAt ?? null),
    usageTotal: count(discount?.usageLimitTotal),
    usagePerCustomer: count(discount?.usageLimitPerCustomer),
  };
}

/** The create/update body, or which field could not be read. */
export function discountBody(
  form: DiscountForm,
): { body: Record<string, unknown> } | { error: "badAmount" | "badDate" } {
  const maxDiscountAmount = optionalPounds(form.maxDiscount);
  const minimumOrderTotal = optionalPounds(form.minimumOrder);
  if (maxDiscountAmount === undefined || minimumOrderTotal === undefined) {
    return { error: "badAmount" };
  }
  const startsAt = fromLocalInput(form.startsAt);
  if (!startsAt) {
    return { error: "badDate" };
  }
  const targeted = form.scope === "TARGETED";
  return {
    body: {
      code: form.code.trim() || null,
      nameAr: form.nameAr.trim(),
      nameEn: form.nameEn.trim(),
      value: optionalInt(form.value),
      scope: form.scope,
      // A store-wide discount has no targets (the API refuses them).
      productIds: targeted ? form.productIds : [],
      categoryIds: targeted ? form.categoryIds : [],
      brandIds: targeted ? form.brandIds : [],
      maxDiscountAmount,
      minimumOrderTotal,
      startsAt,
      endsAt: fromLocalInput(form.endsAt),
      usageLimitTotal: optionalInt(form.usageTotal),
      usageLimitPerCustomer: optionalInt(form.usagePerCustomer),
    },
  };
}

export const SEGMENT_TYPES = [
  "ALL_OPTED_IN",
  "PREVIOUS_BUYERS",
  "PRODUCT_BUYERS",
  "BRAND_BUYERS",
  "CATEGORY_BUYERS",
  "INACTIVE",
  "HIGH_SPENDING",
] as const satisfies readonly SegmentDefinition["type"][];

export interface SegmentForm {
  type: SegmentDefinition["type"];
  channel: SegmentDefinition["channel"];
  productIds: string[];
  brandIds: string[];
  categoryIds: string[];
  inactiveDays: string;
  minSpent: string;
}

export function segmentForm(segment?: SegmentDefinition): SegmentForm {
  return {
    type: segment?.type ?? "ALL_OPTED_IN",
    channel: segment?.channel ?? "EMAIL",
    productIds: segment?.type === "PRODUCT_BUYERS" ? segment.productIds : [],
    brandIds: segment?.type === "BRAND_BUYERS" ? segment.brandIds : [],
    categoryIds: segment?.type === "CATEGORY_BUYERS" ? segment.categoryIds : [],
    inactiveDays: segment?.type === "INACTIVE" ? String(segment.inactiveDays) : "",
    minSpent: segment?.type === "HIGH_SPENDING" ? (formatPiastres(segment.minSpent) ?? "") : "",
  };
}

/** The TASK-047 segment definition, or null while it is incomplete. */
export function segmentDefinition(form: SegmentForm): SegmentDefinition | null {
  const { type, channel } = form;
  switch (type) {
    case "ALL_OPTED_IN":
    case "PREVIOUS_BUYERS":
      return { type, channel };
    case "PRODUCT_BUYERS":
      return form.productIds.length ? { type, channel, productIds: form.productIds } : null;
    case "BRAND_BUYERS":
      return form.brandIds.length ? { type, channel, brandIds: form.brandIds } : null;
    case "CATEGORY_BUYERS":
      return form.categoryIds.length ? { type, channel, categoryIds: form.categoryIds } : null;
    case "INACTIVE": {
      const days = optionalInt(form.inactiveDays);
      return typeof days === "number" && days > 0 ? { type, channel, inactiveDays: days } : null;
    }
    case "HIGH_SPENDING": {
      const minSpent = parsePounds(form.minSpent);
      return minSpent ? { type, channel, minSpent } : null;
    }
  }
}

/**
 * Idempotency key for a retryable request: kept while the same body is
 * retried (a lost answer replays the first result), replaced when the body
 * changes. The caller forgets it after a success.
 */
export function idempotencyKeyFor(
  previous: { fingerprint: string; key: string } | null,
  body: unknown,
  newKey: () => string = () => crypto.randomUUID(),
): { fingerprint: string; key: string } {
  const fingerprint = JSON.stringify(body);
  return previous?.fingerprint === fingerprint ? previous : { fingerprint, key: newKey() };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** An id (customer, order) typed or pasted by staff, or null when it is not a UUID. */
export function parseUuid(text: string): string | null {
  const trimmed = text.trim();
  return UUID.test(trimmed) ? trimmed.toLowerCase() : null;
}
