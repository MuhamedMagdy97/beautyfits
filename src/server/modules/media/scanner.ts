/**
 * Security check of uploaded files before they can be used (Q176, Security
 * Requirements §7, ADR-0021).
 *
 * Callers depend on the `MalwareScanner` port. No antivirus service is chosen
 * yet, so the built-in scanner looks for content that has no business in a
 * picture: markup and script that browsers or servers could run if the file
 * were ever served as something else. Together with the structural checks in
 * `image-inspection.ts` (one well-formed image, nothing appended) this is the
 * v1 "security validation"; an antivirus service can replace or extend it
 * without changing callers.
 */

export type ScanResult = { safe: true } | { safe: false; reason: "file_content_suspicious" };

export interface MalwareScanner {
  scan(bytes: Buffer): Promise<ScanResult>;
}

/**
 * Lowercase ASCII markers of HTML, SVG, script and server-side code. They are
 * long enough that compressed image data practically never contains them.
 */
const SUSPICIOUS_MARKERS = [
  "<script",
  "<html",
  "<svg",
  "<iframe",
  "<object",
  "<embed",
  "<?php",
  "<%@",
  "javascript:",
  "onerror=",
  "onload=",
];

/** Lowercases ASCII letters only, keeping one byte per byte. */
function asciiLower(bytes: Buffer): string {
  return bytes.toString("latin1").toLowerCase();
}

export const builtInScanner: MalwareScanner = {
  async scan(bytes) {
    const text = asciiLower(bytes);
    for (const marker of SUSPICIOUS_MARKERS) {
      if (text.includes(marker)) {
        return { safe: false, reason: "file_content_suspicious" };
      }
    }
    return { safe: true };
  },
};
