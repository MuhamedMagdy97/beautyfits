import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AppError } from "@/server/errors/app-error";
import { resolveRequestId } from "@/server/http/request-id";
import { errorResponse, ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseJsonBody, parseQuery } from "@/server/http/validation";
import { createLogger, type LogLevel } from "@/server/logging/logger";

function silentLogger() {
  const lines: { level: LogLevel; line: string }[] = [];
  return {
    logger: createLogger({ level: "debug", write: (level, line) => lines.push({ level, line }) }),
    lines,
  };
}

describe("resolveRequestId", () => {
  it("keeps a well-formed incoming id", () => {
    expect(resolveRequestId(new Headers({ "x-request-id": "abc-1234.5678" }))).toBe(
      "abc-1234.5678",
    );
  });

  it("replaces a missing or unsafe id with a UUID", () => {
    const uuid = /^[0-9a-f-]{36}$/;
    expect(resolveRequestId(new Headers())).toMatch(uuid);
    expect(resolveRequestId(new Headers({ "x-request-id": "bad id <script>" }))).toMatch(uuid);
    expect(resolveRequestId(new Headers({ "x-request-id": "x".repeat(200) }))).toMatch(uuid);
  });
});

describe("response envelopes", () => {
  it("wraps success data with meta.requestId", async () => {
    const res = ok("req-12345678", { a: 1 });
    expect(res.status).toBe(200);
    expect(res.headers.get("x-request-id")).toBe("req-12345678");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ data: { a: 1 }, meta: { requestId: "req-12345678" } });
  });

  it("includes pagination for collections", async () => {
    const pagination = { page: 1, pageSize: 24, total: 240, totalPages: 10 };
    const res = ok("req-12345678", [], { pagination });
    expect((await res.json()).meta).toEqual({ requestId: "req-12345678", pagination });
  });

  it("formats errors per the API contract", async () => {
    const res = errorResponse(
      "req-12345678",
      new AppError("CONFLICT", "Already exists", { details: { f: 1 } }),
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: {
        code: "CONFLICT",
        message: "Already exists",
        details: { f: 1 },
        requestId: "req-12345678",
      },
    });
  });
});

describe("validation helpers", () => {
  const schema = z.object({ name: z.string().min(1), qty: z.number().int() });

  it("returns parsed JSON bodies", async () => {
    const req = new Request("http://x/api", {
      method: "POST",
      body: JSON.stringify({ name: "a", qty: 2 }),
    });
    await expect(parseJsonBody(req, schema)).resolves.toEqual({ name: "a", qty: 2 });
  });

  it("rejects malformed JSON as VALIDATION_ERROR", async () => {
    const req = new Request("http://x/api", { method: "POST", body: "{nope" });
    await expect(parseJsonBody(req, schema)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 400,
    });
  });

  it("reports field issues with paths", async () => {
    const req = new Request("http://x/api", {
      method: "POST",
      body: JSON.stringify({ name: "", qty: 1.5 }),
    });
    const error = await parseJsonBody(req, schema).catch((e: AppError) => e);
    expect(error).toBeInstanceOf(AppError);
    const paths = ((error as AppError).details.issues as { path: string }[])
      .map((i) => i.path)
      .sort();
    expect(paths).toEqual(["name", "qty"]);
  });

  it("parses query parameters with coercion and repeated keys", () => {
    const query = z.object({ page: z.coerce.number().int().min(1), status: z.array(z.string()) });
    const req = new Request("http://x/api?page=2&status=A&status=B");
    expect(parseQuery(req, query)).toEqual({ page: 2, status: ["A", "B"] });
  });
});

describe("withApi", () => {
  it("passes a request id and returns handler responses", async () => {
    const { logger } = silentLogger();
    const handler = withApi(async (_req, { requestId }) => ok(requestId, { fine: true }), {
      logger,
    });
    const res = await handler(
      new Request("http://x/api/v1/t", { headers: { "x-request-id": "incoming-123" } }),
      {},
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("x-request-id")).toBe("incoming-123");
    expect((await res.json()).meta.requestId).toBe("incoming-123");
  });

  it("maps AppError to its envelope and status", async () => {
    const { logger } = silentLogger();
    const handler = withApi(
      async () => {
        throw new AppError("PERMISSION_DENIED", "Not allowed.");
      },
      { logger },
    );
    const res = await handler(new Request("http://x/api/v1/t"), {});
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("PERMISSION_DENIED");
  });

  it("hides unexpected errors behind INTERNAL_ERROR and logs them", async () => {
    const { logger, lines } = silentLogger();
    const handler = withApi(
      async () => {
        throw new Error("db password=hunter2 leaked");
      },
      { logger },
    );
    const res = await handler(new Request("http://x/api/v1/t?email=a@b.c"), {});
    const body = await res.json();
    expect(res.status).toBe(500);
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(JSON.stringify(body)).not.toContain("hunter2");
    expect(lines.some((l) => l.level === "error")).toBe(true);
    // The access log records the path only, never the query string.
    expect(lines.every((l) => !l.line.includes("a@b.c"))).toBe(true);
  });
});
