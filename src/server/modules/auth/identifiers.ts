/**
 * Customer identifiers: email (DB design §3.1) and Egyptian mobile phone
 * (Business Spec R27).
 */

/** Emails are compared and stored trimmed and lowercased. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

// Arabic-Indic (U+0660–U+0669) and Extended Arabic-Indic (U+06F0–U+06F9) digits,
// which Arabic keyboards produce.
const ARABIC_DIGITS = /[٠-٩۰-۹]/g;

function toAsciiDigits(value: string): string {
  return value.replace(ARABIC_DIGITS, (digit) => {
    const code = digit.charCodeAt(0);
    return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
  });
}

// R27: 010, 011, 012 or 015 followed by 8 digits, written as 01…, +201… or 00201….
const EGYPTIAN_MOBILE = /^(?:0|\+20|0020)(1[0125]\d{8})$/;

/**
 * Normalizes an Egyptian mobile number to E.164 (`+201xxxxxxxxx`), or
 * returns null when the value is not one (R27). Spaces and hyphens between
 * digits are ignored.
 */
export function normalizeEgyptianMobile(input: string): string | null {
  const compact = toAsciiDigits(input).replace(/[\s-]/g, "");
  const match = EGYPTIAN_MOBILE.exec(compact);
  return match ? `+20${match[1]}` : null;
}
