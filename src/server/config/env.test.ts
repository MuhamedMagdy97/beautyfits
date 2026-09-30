import { describe, expect, it } from "vitest";
import { EnvValidationError, parseEnv } from "@/server/config/env";

const VALID_URL = "postgresql://user:s3cret-value@localhost:5432/db";

describe("parseEnv", () => {
  it("parses a valid environment and applies defaults", () => {
    const env = parseEnv({ DATABASE_URL: VALID_URL });
    expect(env).toEqual({ NODE_ENV: "development", DATABASE_URL: VALID_URL, LOG_LEVEL: "info" });
  });

  it("accepts explicit values", () => {
    const env = parseEnv({ DATABASE_URL: VALID_URL, NODE_ENV: "production", LOG_LEVEL: "warn" });
    expect(env.NODE_ENV).toBe("production");
    expect(env.LOG_LEVEL).toBe("warn");
  });

  it("rejects a missing DATABASE_URL", () => {
    expect(() => parseEnv({})).toThrow(EnvValidationError);
  });

  it("rejects a non-postgres DATABASE_URL and an unknown LOG_LEVEL, naming both", () => {
    try {
      parseEnv({ DATABASE_URL: "mysql://root:hunter2@db/app", LOG_LEVEL: "verbose" });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError);
      const { problems, message } = error as EnvValidationError;
      expect(problems.some((p) => p.startsWith("DATABASE_URL:"))).toBe(true);
      expect(problems.some((p) => p.startsWith("LOG_LEVEL:"))).toBe(true);
      // Values (which may be secrets) never appear in the error.
      expect(message).not.toContain("hunter2");
      expect(message).not.toContain("mysql://");
    }
  });
});
