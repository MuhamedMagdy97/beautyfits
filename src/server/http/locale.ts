/**
 * Language selection (Business Spec R14, API contract §5): `ar` or `en`,
 * default `ar`.
 */
export type SupportedLocale = "ar" | "en";

export const DEFAULT_LOCALE: SupportedLocale = "ar";

/**
 * The preferred supported locale of an `Accept-Language` header, honouring
 * q-values (`en-US;q=0.8, ar;q=0.9` → `ar`). Unsupported or missing → `ar`.
 */
export function localeFromAcceptLanguage(header: string | null): SupportedLocale {
  if (!header) {
    return DEFAULT_LOCALE;
  }
  const ranked = header
    .split(",")
    .map((part, index) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params
        .map((param) => /^\s*q\s*=\s*([\d.]+)\s*$/i.exec(param)?.[1])
        .find((value) => value !== undefined);
      const quality = q === undefined ? 1 : Number(q);
      return {
        language: tag.trim().toLowerCase().split("-")[0],
        quality: Number.isNaN(quality) ? 0 : quality,
        index,
      };
    })
    .filter((entry) => entry.quality > 0)
    .sort((a, b) => b.quality - a.quality || a.index - b.index);

  for (const entry of ranked) {
    if (entry.language === "ar" || entry.language === "en") {
      return entry.language;
    }
  }
  return DEFAULT_LOCALE;
}
