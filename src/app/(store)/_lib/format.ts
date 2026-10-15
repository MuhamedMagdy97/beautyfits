import type { Lang } from "./lang";

/**
 * Money from the API (integer piastres, API §2) as shown to shoppers, e.g.
 * "EGP 1,450" or "1,450.50 EGP" in the page language. Display only: the
 * website never computes prices or totals (backend authoritative).
 */
export function formatMoney(piastres: number, lang: Lang): string {
  const whole = piastres % 100 === 0;
  return new Intl.NumberFormat(lang === "ar" ? "ar-EG" : "en-EG", {
    style: "currency",
    currency: "EGP",
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(piastres / 100);
}
