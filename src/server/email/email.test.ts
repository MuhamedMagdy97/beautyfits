import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createFileEmailSender, toEml } from "@/server/email/email";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function decodeBody(eml: string): string {
  const body = eml.split("\r\n\r\n")[1].replace(/\r\n/g, "");
  return Buffer.from(body, "base64").toString("utf8");
}

describe("toEml", () => {
  it("encodes non-ASCII subjects and bodies as UTF-8", () => {
    const eml = toEml(
      { to: "sara@example.com", subject: "رمز التحقق", text: "الرمز 123456" },
      new Date("2026-10-01T10:00:00Z"),
      "abc",
    );
    expect(eml).toContain("To: sara@example.com\r\n");
    expect(eml).toContain(
      `Subject: =?UTF-8?B?${Buffer.from("رمز التحقق").toString("base64")}?=\r\n`,
    );
    expect(eml).toContain("Content-Type: text/plain; charset=UTF-8");
    expect(decodeBody(eml)).toBe("الرمز 123456");
  });

  it("keeps ASCII subjects readable", () => {
    const eml = toEml({ to: "a@b.co", subject: "Hello", text: "x" }, new Date(), "id");
    expect(eml).toContain("Subject: Hello\r\n");
  });
});

describe("file email sender", () => {
  it("writes one .eml file per message into the mailbox directory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bf-mail-"));
    dirs.push(dir);
    const sender = createFileEmailSender(join(dir, "nested"));
    await sender.send({ to: "sara@example.com", subject: "Code", text: "Your code is 654321" });
    const files = await readdir(join(dir, "nested"));
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/\.eml$/);
    const eml = await readFile(join(dir, "nested", files[0]), "utf8");
    expect(decodeBody(eml)).toBe("Your code is 654321");
  });

  it("refuses header injection", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bf-mail-"));
    dirs.push(dir);
    const sender = createFileEmailSender(dir);
    await expect(
      sender.send({ to: "a@b.co\r\nBcc: x@y.z", subject: "s", text: "t" }),
    ).rejects.toThrow();
  });
});
