/**
 * Display and input of money in the dashboard (TASK-053). The API speaks
 * integer piastres (API §2); staff type and read Egyptian pounds. No floating
 * point is used for the conversion.
 */

/** 12345 → "123.45"; null → null. */
export function formatPiastres(value: number | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** "123.4" → 12340. Up to two decimals, no sign; anything else → null. */
export function parsePounds(input: string): number | null {
  const match = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(input.trim());
  if (!match) {
    return null;
  }
  return Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
}

/** Basis points → "40.00%". */
export function formatBasisPoints(value: number | null | undefined): string | null {
  const text = formatPiastres(value);
  return text === null ? null : `${text}%`;
}
