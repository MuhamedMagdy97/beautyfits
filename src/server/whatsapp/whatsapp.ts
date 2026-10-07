import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getEnv } from "@/server/config/env";

/**
 * Outgoing WhatsApp messages (ADR-0043).
 *
 * Callers depend on the `WhatsAppSender` port. No WhatsApp provider is
 * chosen yet (Architecture §27), so the only transport writes each message to
 * a local directory as a `.json` file. A provider transport replaces it later
 * without changing callers. Like email, messages are sent only after the
 * transaction that produced them has committed.
 */

export interface WhatsAppMessage {
  /** E.164 phone number, e.g. +201012345678. */
  to: string;
  /** Plain text (UTF-8). */
  text: string;
}

export interface WhatsAppSender {
  /** Resolves with the provider's message reference; rejects on failure. */
  send(message: WhatsAppMessage): Promise<{ reference: string }>;
}

/** Writes each message to `<dir>/<timestamp>-<id>.json`. */
export function createFileWhatsAppSender(
  dir: string,
  now: () => Date = () => new Date(),
): WhatsAppSender {
  return {
    async send(message) {
      if (!/^\+\d{8,15}$/.test(message.to)) {
        throw new Error("WhatsApp recipient must be an E.164 phone number");
      }
      const date = now();
      const id = randomUUID();
      await mkdir(dir, { recursive: true });
      const stamp = date.toISOString().replace(/[:.]/g, "-");
      const file = { id, date: date.toISOString(), ...message };
      await writeFile(join(dir, `${stamp}-${id}.json`), JSON.stringify(file, null, 2), "utf8");
      return { reference: id };
    },
  };
}

let defaultSender: WhatsAppSender | undefined;

export function getWhatsAppSender(): WhatsAppSender {
  defaultSender ??= createFileWhatsAppSender(getEnv().WHATSAPP_DIR);
  return defaultSender;
}
