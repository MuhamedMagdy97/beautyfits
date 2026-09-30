import { describe, expect, it } from "vitest";
import { GET as notFound } from "@/app/api/v1/[[...path]]/route";
import { GET as health } from "@/app/api/v1/health/route";

describe("/api/v1 routes", () => {
  it("GET /api/v1/health returns the liveness envelope", async () => {
    const res = await health(new Request("http://localhost/api/v1/health"), {});
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual({ status: "ok" });
    expect(body.meta.requestId).toBe(res.headers.get("x-request-id"));
  });

  it("unknown /api/v1 paths return a NOT_FOUND error envelope", async () => {
    const res = await notFound(new Request("http://localhost/api/v1/does-not-exist"), {});
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatchObject({ code: "NOT_FOUND", details: {} });
    expect(typeof body.error.requestId).toBe("string");
  });
});
