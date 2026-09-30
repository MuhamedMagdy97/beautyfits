import { describe, expect, it } from "vitest";
import { AppError, ERROR_CODES, ERROR_HTTP_STATUS, isAppError } from "@/server/errors/app-error";

describe("AppError", () => {
  it("maps every contract error code to an HTTP error status", () => {
    for (const code of ERROR_CODES) {
      const status = ERROR_HTTP_STATUS[code];
      expect(status, code).toBeGreaterThanOrEqual(400);
      expect(status, code).toBeLessThan(600);
    }
    expect(Object.keys(ERROR_HTTP_STATUS).sort()).toEqual([...ERROR_CODES].sort());
  });

  it("carries code, status and details", () => {
    const error = new AppError("NOT_FOUND", "Missing", { details: { id: "x" } });
    expect(error.code).toBe("NOT_FOUND");
    expect(error.status).toBe(404);
    expect(error.details).toEqual({ id: "x" });
    expect(isAppError(error)).toBe(true);
    expect(isAppError(new Error("plain"))).toBe(false);
  });

  it("defaults details to an empty object", () => {
    expect(new AppError("CONFLICT", "c").details).toEqual({});
  });
});
