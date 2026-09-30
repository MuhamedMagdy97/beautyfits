import { AppError, type ErrorDetails } from "@/server/errors/app-error";
import { REQUEST_ID_HEADER } from "@/server/http/request-id";

/** Response shapes from docs/api/api-contract.md §6. */

export interface Pagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface SuccessBody<T> {
  data: T;
  meta: { requestId: string; pagination?: Pagination };
}

export interface ErrorBody {
  error: { code: string; message: string; details: ErrorDetails; requestId: string };
}

function json(body: unknown, status: number, requestId: string, init?: ResponseInit): Response {
  const headers = new Headers(init?.headers);
  headers.set(REQUEST_ID_HEADER, requestId);
  headers.set("cache-control", "no-store");
  return Response.json(body, { ...init, status, headers });
}

export function ok<T>(
  requestId: string,
  data: T,
  options: { status?: number; pagination?: Pagination; init?: ResponseInit } = {},
): Response {
  const meta: SuccessBody<T>["meta"] = { requestId };
  if (options.pagination) {
    meta.pagination = options.pagination;
  }
  return json({ data, meta } satisfies SuccessBody<T>, options.status ?? 200, requestId, options.init);
}

export function errorResponse(requestId: string, error: AppError): Response {
  const body: ErrorBody = {
    error: {
      code: error.code,
      message: error.message,
      details: error.details,
      requestId,
    },
  };
  return json(body, error.status, requestId);
}
