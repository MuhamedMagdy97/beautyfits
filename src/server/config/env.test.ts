import { describe, expect, it } from "vitest";
import { EnvValidationError, parseEnv } from "@/server/config/env";

const VALID_URL = "postgresql://user:s3cret-value@localhost:5432/db";

describe("parseEnv", () => {
  it("parses a valid environment and applies defaults", () => {
    const env = parseEnv({ DATABASE_URL: VALID_URL });
    expect(env).toEqual({
      NODE_ENV: "development",
      DATABASE_URL: VALID_URL,
      LOG_LEVEL: "info",
      TRUSTED_PROXIES: [],
      AUTH_ALLOWED_ORIGINS: [],
      MAIL_DIR: ".mail",
      WHATSAPP_DIR: ".whatsapp",
      WEBSITE_URL: "http://localhost:3000",
      MEDIA_DIR: ".media",
      DASHBOARD_URL: "http://localhost:3000",
    });
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

  it("parses trusted proxies and allowed origins as lists", () => {
    const env = parseEnv({
      DATABASE_URL: VALID_URL,
      TRUSTED_PROXIES: " 10.0.0.1, 172.16.0.0/12 ,fd00::/8,",
      AUTH_ALLOWED_ORIGINS: "https://beautyfits.example, http://localhost:3000",
    });
    expect(env.TRUSTED_PROXIES).toEqual(["10.0.0.1", "172.16.0.0/12", "fd00::/8"]);
    expect(env.AUTH_ALLOWED_ORIGINS).toEqual([
      "https://beautyfits.example",
      "http://localhost:3000",
    ]);
  });

  it("rejects invalid proxies and origins", () => {
    for (const TRUSTED_PROXIES of ["10.0.0.300", "10.0.0.0/33", "proxy.local", "10.0.0.0/8/1"]) {
      expect(() => parseEnv({ DATABASE_URL: VALID_URL, TRUSTED_PROXIES })).toThrow(
        EnvValidationError,
      );
    }
    for (const AUTH_ALLOWED_ORIGINS of ["beautyfits.example", "https://beautyfits.example/path"]) {
      expect(() => parseEnv({ DATABASE_URL: VALID_URL, AUTH_ALLOWED_ORIGINS })).toThrow(
        EnvValidationError,
      );
    }
  });
});
