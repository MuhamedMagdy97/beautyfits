import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getEnv } from "@/server/config/env";

/**
 * Outgoing email (ADR-0014).
 *
 * Callers depend on the `EmailSender` port. No email provider is chosen yet
 * (Architecture §27), so the only transport writes each message to a local
 * mailbox directory as an `.eml` file that any mail client can open. A
 * provider transport replaces it later without changing callers.
 *
 * Messages are sent after the database transaction that created them has
 * committed, and a failed send never rolls that transaction back.
 */

export interface EmailMessage {
  /** Normalized recipient address. */
  to: string;
  subject: string;
  /** Plain-text body (UTF-8). */
  text: string;
}

export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}

/** RFC 2047 encoded-word, so non-ASCII (Arabic) subjects survive. */
function encodeHeader(value: string): string {
  return /^[\x20-\x7e]*$/.test(value)
    ? value
    : `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

/** The message as an RFC 5322 document with a base64 UTF-8 text body. */
export function toEml(message: EmailMessage, date: Date, messageId: string): string {
  const body = Buffer.from(message.text, "utf8").toString("base64").replace(/.{76}/g, "$&\r\n");
  return [
    `Message-ID: <${messageId}@beautyfits.local>`,
    `Date: ${date.toUTCString()}`,
    "From: BeautyFits <no-reply@beautyfits.local>",
    `To: ${message.to}`,
    `Subject: ${encodeHeader(message.subject)}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    body,
    "",
  ].join("\r\n");
}

/** Writes each message to `<dir>/<timestamp>-<id>.eml`. */
export function createFileEmailSender(
  dir: string,
  now: () => Date = () => new Date(),
): EmailSender {
  return {
    async send(message) {
      if (/[\r\n]/.test(message.to) || /[\r\n]/.test(message.subject)) {
        throw new Error("Email header values must not contain line breaks");
      }
      const date = now();
      const id = randomUUID();
      await mkdir(dir, { recursive: true });
      const stamp = date.toISOString().replace(/[:.]/g, "-");
      await writeFile(join(dir, `${stamp}-${id}.eml`), toEml(message, date, id), "utf8");
    },
  };
}

let defaultSender: EmailSender | undefined;

export function getEmailSender(): EmailSender {
  defaultSender ??= createFileEmailSender(getEnv().MAIL_DIR);
  return defaultSender;
}
