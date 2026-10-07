/**
 * Dashboard language choice (R14), shared by the server layout and the
 * client: kept in the `bf_staff_lang` cookie so the server renders the right
 * direction on the first paint.
 */
export const LANG_COOKIE = "bf_staff_lang";
export type Lang = "ar" | "en";

export function parseLang(value: string | undefined): Lang {
  // ponytail: Arabic is the default until the product owner says otherwise (TASK-052 open item).
  return value === "en" ? "en" : "ar";
}
