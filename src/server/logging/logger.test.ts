import { describe, expect, it } from "vitest";
import { createLogger, REDACTED, redact, type LogLevel } from "@/server/logging/logger";

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
