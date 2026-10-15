import { formatPiastres, parsePounds } from "./money";

/**
 * Form helpers of the purchasing and shipping screens (TASK-055). They only
 * shape what staff typed into request bodies; the API validates and decides.
 */

export interface TypedLine {
  sku: string;
  quantity: number;
  /** Piastres. */
  unitCost: number;
}

/**
 * Purchase order lines typed one per line as `SKU, quantity, unit cost in EGP`
 * (e.g. `LIP-01, 12, 45.50`). Blank lines are skipped. Returns the lines, or
 * the 1-based number of the first line that cannot be read.
 */
export function parsePurchaseLines(text: string): { lines: TypedLine[] } | { badLine: number } {
  const lines: TypedLine[] = [];
  const rows = text.split("\n");
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index].trim();
    if (row === "") continue;
    const parts = row.split(",").map((part) => part.trim());
    const quantity = /^\d{1,6}$/.test(parts[1] ?? "") ? Number(parts[1]) : 0;
    const unitCost = parts.length === 3 ? parsePounds(parts[2]) : null;
    if (!parts[0] || quantity < 1 || unitCost === null || unitCost < 1) {
      return { badLine: index + 1 };
    }
    lines.push({ sku: parts[0], quantity, unitCost });
  }
  return lines.length > 0 ? { lines } : { badLine: 1 };
}

/** The reverse of `parsePurchaseLines`, to edit a draft's lines. */
export function formatPurchaseLines(
  items: readonly { sku: string; orderedQuantity: number; unitCost?: number }[],
): string {
  return items
    .map((item) => `${item.sku}, ${item.orderedQuantity}, ${formatPiastres(item.unitCost) ?? ""}`)
    .join("\n");
}

/** A whole-number count typed in a field: blank → 0; anything else that is not digits → null. */
export function countField(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === "") return 0;
  return /^\d{1,6}$/.test(trimmed) ? Number(trimmed) : null;
}

/** An order snapshot name (`{ ar, en }`) in the current language. */
export function snapshotName(value: unknown, english: boolean): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const { ar, en } = value as { ar?: string | null; en?: string | null };
    return (english ? en : ar) ?? en ?? ar ?? "";
  }
  return "";
}
