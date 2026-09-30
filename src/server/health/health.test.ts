import { describe, expect, it } from "vitest";
import { checkLiveness, checkReadiness } from "@/server/health/health";
import { createLogger } from "@/server/logging/logger";

const logger = createLogger({ write: () => {} });

describe("health", () => {
  it("liveness is always ok", () => {
    expect(checkLiveness()).toEqual({ status: "ok" });
  });

  it("is ready when the database responds", async () => {
    const report = await checkReadiness({ pingDatabase: async () => {}, logger });
    expect(report).toEqual({ status: "ready", checks: { database: "up" } });
  });

  it("is not ready when the database ping fails", async () => {
    const report = await checkReadiness({
      pingDatabase: async () => {
        throw new Error("ECONNREFUSED");
      },
      logger,
    });
    expect(report).toEqual({ status: "not_ready", checks: { database: "down" } });
  });

  it("is not ready when the database ping times out", async () => {
    const report = await checkReadiness({
      pingDatabase: () => new Promise(() => {}),
      logger,
      timeoutMs: 10,
    });
    expect(report.checks.database).toBe("down");
  });
});
