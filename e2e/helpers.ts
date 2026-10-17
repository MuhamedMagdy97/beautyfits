import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { BASE_URL, MAIL_DIR, OWNER } from "./config";

/** A browser context with the English storefront and dashboard (both default to Arabic). */
export async function englishContext(browser: Browser): Promise<BrowserContext> {
  const context = await browser.newContext();
  await context.addCookies(
    ["bf_lang", "bf_staff_lang"].map((name) => ({ name, value: "en", url: BASE_URL })),
  );
  return context;
}

/**
 * The newest 6-digit code emailed to `to` after `since` (ADR-0014: the local
 * mailbox writes each email as an .eml file with a base64 UTF-8 body).
 */
export async function readOtp(to: string, since: number): Promise<string> {
  let code: string | undefined;
  await expect
    .poll(
      async () => {
        const names = await readdir(MAIL_DIR).catch(() => [] as string[]);
        let newest = -1;
        for (const name of names.filter((n) => n.endsWith(".eml"))) {
          const eml = await readFile(join(MAIL_DIR, name), "utf8");
          const [head, body = ""] = eml.split("\r\n\r\n");
          const date = Date.parse(/^Date: (.+)$/m.exec(head)?.[1] ?? "");
          // Date header has second precision; allow the same second.
          if (!head.includes(`\r\nTo: ${to}\r\n`) || date < since - 1000 || date < newest) {
            continue;
          }
          const text = Buffer.from(body.replace(/\s+/g, ""), "base64").toString("utf8");
          const match = /\b(\d{6})\b/.exec(text);
          if (match) {
            newest = date;
            code = match[1];
          }
        }
        return code;
      },
      { message: `no code emailed to ${to}`, timeout: 15_000 },
    )
    .toBeTruthy();
  return code!;
}

/** Staff sign-in with password and the emailed code (R28). */
export async function staffSignIn(page: Page): Promise<void> {
  await page.goto("/staff/login");
  await page.getByLabel("Work email").fill(OWNER.email);
  await page.getByLabel("Password").fill(OWNER.password);
  const since = Date.now();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Email code").fill(await readOtp(OWNER.email, since));
  await page.getByRole("button", { name: "Verify and sign in" }).click();
  await expect(page).not.toHaveURL(/\/staff\/login/);
}

/** A cookie-authenticated API call from the page's session (CSRF needs the Origin). */
export async function apiPost(page: Page, path: string, data: unknown): Promise<void> {
  const response = await page.request.post(path, {
    data,
    headers: { origin: BASE_URL },
  });
  expect(response.status(), await response.text()).toBeLessThan(300);
}

export async function apiGet<T>(page: Page, path: string): Promise<T> {
  const response = await page.request.get(path);
  expect(response.status(), await response.text()).toBe(200);
  return ((await response.json()) as { data: T }).data;
}

/** Fills the storefront delivery address with the first governorate and area. */
export async function fillAddress(page: Page, recipient: string): Promise<void> {
  await page.locator('input[name="recipientName"]').fill(recipient);
  await page.locator('input[name="phone"]').fill("01012345678");
  await page.getByLabel("Governorate *").selectOption({ index: 1 });
  await page.locator('select[name="areaId"]').selectOption({ index: 1 });
  await page.locator('input[name="street"]').fill("12 Tahrir Street");
}
