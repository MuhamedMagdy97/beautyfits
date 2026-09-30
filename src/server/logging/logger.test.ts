import { describe, expect, it } from "vitest";
import { createLogger, REDACTED, redact, redactText, type LogLevel } from "@/server/logging/logger";

function capture(level: LogLevel = "debug") {
  const lines: { level: LogLevel; entry: Record<string, unknown> }[] = [];
  const logger = createLogger({
    level,
    write: (entryLevel, line) => lines.push({ level: entryLevel, entry: JSON.parse(line) }),
  });
  return { logger, lines };
}

describe("logger", () => {
  it("writes one JSON object per entry with time, level and msg", () => {
    const { logger, lines } = capture();
    logger.info("hello", { count: 2 });
    expect(lines).toHaveLength(1);
    expect(lines[0].entry).toMatchObject({ level: "info", msg: "hello", count: 2 });
    expect(typeof lines[0].entry.time).toBe("string");
  });

  it("drops entries below the configured level", () => {
    const { logger, lines } = capture("warn");
    logger.debug("d");
    logger.info("i");
    logger.warn("w");
    logger.error("e");
    expect(lines.map((l) => l.level)).toEqual(["warn", "error"]);
  });

  it("includes child bindings", () => {
    const { logger, lines } = capture();
    logger.child({ requestId: "req-12345678" }).info("x");
    expect(lines[0].entry.requestId).toBe("req-12345678");
  });

  it("redacts sensitive keys at any depth", () => {
    const { logger, lines } = capture();
    logger.info("login", {
      email: "a@example.com",
      password: "correct horse battery staple",
      body: { otp: "123456", nested: { refreshToken: "rt", apiKey: "k" } },
      headers: { authorization: "Bearer abc", cookie: "sid=1" },
      items: [{ passwordHash: "h" }],
    });
    const serialized = JSON.stringify(lines[0].entry);
    for (const secret of ["correct horse", "123456", "\"rt\"", "Bearer abc", "sid=1", "\"h\""]) {
      expect(serialized).not.toContain(secret);
    }
    expect(lines[0].entry.password).toBe(REDACTED);
    expect(lines[0].entry.email).toBe("a@example.com");
  });

  it("serializes errors with name and message", () => {
    const value = redact({ err: new TypeError("boom") }) as { err: Record<string, unknown> };
    expect(value.err).toMatchObject({ name: "TypeError", message: "boom" });
  });

  it("serializes bigint values", () => {
    expect(redact({ amount: BigInt(150) })).toEqual({ amount: "150" });
  });
});

describe("redaction of secrets inside text", () => {
  it.each([
    [
      "connection strings",
      "Can't reach postgresql://beauty:s3cr3t-pw@db.internal:5432/beautyfits",
      "s3cr3t-pw",
      "postgresql://beauty:[REDACTED]@db.internal:5432/beautyfits",
    ],
    ["Bearer tokens", "Upstream rejected Bearer abc.DEF-123_xyz", "abc.DEF-123_xyz", "Bearer [REDACTED]"],
    ["Basic credentials", "auth failed with Basic dXNlcjpwdw==", "dXNlcjpwdw==", "Basic [REDACTED]"],
    [
      "JSON Web Tokens",
      "bad jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl here",
      "eyJhbGciOiJIUzI1NiJ9",
      "bad jwt [REDACTED] here",
    ],
    ["key=value pairs", "retry with password=hunter2&user=a", "hunter2", "password=[REDACTED]&user=a"],
    ["key: value pairs", "OTP: 482913 was rejected", "482913", "OTP: [REDACTED] was rejected"],
    ["JSON fragments", 'body {"refreshToken":"rt-999","qty":2}', "rt-999", '"refreshToken":"[REDACTED]"'],
    ["query parameters", "GET /x?api_key=k-123&page=2", "k-123", "api_key=[REDACTED]&page=2"],
  ])("masks %s", (_label, text, secret, expected) => {
    const masked = redactText(text);
    expect(masked).not.toContain(secret);
    expect(masked).toContain(expected);
  });

  it("leaves ordinary text unchanged", () => {
    for (const text of [
      "Order 0192 confirmed for a@example.com",
      "Token expired",
      "https://example.com/products?page=2",
      "Stock changed for variant 42",
    ]) {
      expect(redactText(text)).toBe(text);
    }
  });

  it("masks secrets in logged error messages, stacks and causes", () => {
    const { logger, lines } = capture();
    const cause = new Error("connect failed: postgres://app:db-pass-1@localhost/beautyfits");
    const error = new Error("login failed: password=hunter2", { cause });
    logger.error("request failed with Bearer tok-777", { err: error, note: "session_id=sid-42" });

    const serialized = JSON.stringify(lines[0].entry);
    for (const secret of ["hunter2", "db-pass-1", "tok-777", "sid-42"]) {
      expect(serialized).not.toContain(secret);
    }
    const err = lines[0].entry.err as Record<string, unknown>;
    expect(err.message).toBe("login failed: password=[REDACTED]");
    expect(String(err.stack)).toContain("password=[REDACTED]");
    expect(lines[0].entry.msg).toBe("request failed with Bearer [REDACTED]");
  });
});
