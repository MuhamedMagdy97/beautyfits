/**
 * Storefront language choice (R14), shared by the server layouts and the
 * client: kept in the `bf_lang` cookie so the server renders the right
 * direction on the first paint. The dashboard keeps its own `bf_staff_lang`.
 */
export const STORE_LANG_COOKIE = "bf_lang";
export type Lang = "ar" | "en";

export function parseLang(value: string | undefined): Lang {
  // ponytail: Arabic (the API default, API §5) until the product owner decides (TASK-058 open item).
  return value === "en" ? "en" : "ar";
}
