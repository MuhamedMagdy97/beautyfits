/**
 * Pure helpers of the analytics and home screens (TASK-052A, ADR-0065).
 * The API computes every figure; these only build the query and size bars.
 */

export const RANGES = ["TODAY", "YESTERDAY", "7D", "30D", "90D", "CUSTOM"] as const;
export type Range = (typeof RANGES)[number];

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The `range` query of `/admin/analytics/*` (API "TASK-051 Amendments").
 * A custom range needs both days, `to` not before `from`; else null (the
 * API checks again, including the 366-day limit).
 */
export function reportQuery(range: Range, from = "", to = ""): string | null {
  if (range !== "CUSTOM") {
    return `range=${range}`;
  }
  if (!DAY.test(from) || !DAY.test(to) || to < from) {
    return null;
  }
  return `range=CUSTOM&from=${from}&to=${to}`;
}

/** `part` as a whole percent of `whole` (0 when `whole` is 0), for bar widths and rates. */
export function percent(part: number, whole: number): number {
  return whole > 0 ? Math.round((part * 100) / whole) : 0;
}

/** Total of a list endpoint read with `pageSize=1`: `totalPages` is then the item count. */
export function countPath(path: string): string {
  return `${path}${path.includes("?") ? "&" : "?"}pageSize=1`;
}
