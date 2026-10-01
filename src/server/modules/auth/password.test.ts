import { describe, expect, it } from "vitest";
import { createScryptHasher } from "@/server/modules/auth/password-hash";
import { checkPasswordPolicy, isCommonPassword } from "@/server/modules/auth/password-policy";

const FAST = { N: 1024, r: 8, p: 1, keyLength: 32, saltLength: 16 };

describe("password policy (Q156)", () => {
  it("requires at least 12 characters and allows long passphrases", () => {
    expect(checkPasswordPolicy("short pass!")).toBe("password_too_short"); // 11
    expect(checkPasswordPolicy("violet-kettle")).toBeNull(); // 13
    expect(checkPasswordPolicy("b".repeat(256))).toBeNull();
    expect(checkPasswordPolicy("b".repeat(257))).toBe("password_too_long");
  });

  it("imposes no composition rules", () => {
    expect(checkPasswordPolicy("lowercase only words here")).toBeNull();
  });

  it("counts Unicode code points, not UTF-16 units", () => {
    // 11 emoji are 22 UTF-16 units but 11 characters.
    expect(checkPasswordPolicy("🌸".repeat(11))).toBe("password_too_short");
    expect(checkPasswordPolicy("🌸".repeat(12))).toBeNull();
  });

  it("rejects common/breached passwords case-insensitively", () => {
    expect(isCommonPassword("123456789012")).toBe(true);
    expect(checkPasswordPolicy("PasswordPassword")).toBe("password_common");
    expect(checkPasswordPolicy("qwertyuiop12")).toBe("password_common");
    expect(isCommonPassword("teal lantern over the nile")).toBe(false);
  });

  it("applies NFKC before checking (full-width digits)", () => {
    expect(checkPasswordPolicy("１２３４５６７８９０１２")).toBe("password_common");
  });
});

describe("scrypt password hasher", () => {
  const hasher = createScryptHasher(FAST);

  it("stores the parameters with a random salt", async () => {
    const a = await hasher.hash("teal lantern over the nile");
    const b = await hasher.hash("teal lantern over the nile");
    expect(a).toMatch(/^scrypt\$N=1024,r=8,p=1\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/);
    expect(a).not.toBe(b);
    expect(a).not.toContain("lantern");
  });

  it("verifies the right password only", async () => {
    const stored = await hasher.hash("teal lantern over the nile");
    expect(await hasher.verify("teal lantern over the nile", stored)).toBe(true);
    expect(await hasher.verify("teal lantern over the Nile", stored)).toBe(false);
  });

  it("verifies with the parameters stored in the hash", async () => {
    const stored = await createScryptHasher({ ...FAST, N: 2048 }).hash(
      "teal lantern over the nile",
    );
    expect(await hasher.verify("teal lantern over the nile", stored)).toBe(true);
  });

  it("treats NFKC-equivalent passwords as the same", async () => {
    const stored = await hasher.hash("ｆｕｌｌｗｉｄｔｈ ｐａｓｓ");
    expect(await hasher.verify("fullwidth pass", stored)).toBe(true);
  });

  it("rejects malformed stored hashes", async () => {
    expect(await hasher.verify("anything at all", "")).toBe(false);
    expect(await hasher.verify("anything at all", "bcrypt$2b$10$abc")).toBe(false);
    expect(await hasher.verify("anything at all", "scrypt$N=1024,r=8,p=1$c2FsdA$")).toBe(false);
  });

  it("performs a dummy verification without throwing", async () => {
    await expect(hasher.verifyDummy("whatever password")).resolves.toBeUndefined();
  });
});
