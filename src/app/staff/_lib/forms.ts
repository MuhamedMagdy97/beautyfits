/**
 * Form value helpers for the catalog screens (TASK-053). They only shape
 * what staff typed into request bodies; the API validates everything.
 */

/** "shade: Red\nsize: 30 ml" → { shade: "Red", size: "30 ml" }; blank → null. */
export function parseAttributes(text: string): Record<string, string> | null {
  const entries = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const at = line.indexOf(":");
      return at < 0 ? [line, ""] : [line.slice(0, at).trim(), line.slice(at + 1).trim()];
    });
  return entries.length > 0 ? Object.fromEntries(entries) : null;
}

export function formatAttributes(attributes: Record<string, string> | null): string {
  return Object.entries(attributes ?? {})
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n");
}

/** Optional whole-number field: "" → null, "12" → 12; other text is sent as typed so the API refuses it. */
export function optionalInt(text: string): number | string | null {
  const trimmed = text.trim();
  return trimmed === "" ? null : /^-?\d+$/.test(trimmed) ? Number(trimmed) : trimmed;
}

/** A trimmed form field, or undefined when blank (so it is left out of the body). */
export function field(form: FormData, name: string): string | undefined {
  const value = String(form.get(name) ?? "").trim();
  return value === "" ? undefined : value;
}
