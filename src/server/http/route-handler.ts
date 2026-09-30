import { AppError, isAppError } from "@/server/errors/app-error";
import { errorResponse } from "@/server/http/response";
import { REQUEST_ID_HEADER, resolveRequestId } from "@/server/http/request-id";
import { logger as rootLogger, type Logger } from "@/server/logging/logger";

export interface ApiContext {
  requestId: string;
  logger: Logger;
}

export type ApiHandler<RouteContext> = (
  request: Request,
  api: ApiContext,
  routeContext: RouteContext,
) => Promise<Response>;

/**
 * Wraps a Next.js Route Handler with the API cross-cutting concerns:
 * request id, request-scoped logger, access log, and error mapping to the
 * standard error envelope. Route handlers stay thin: validate input, call a
 * server module, return `ok(...)`. Business logic never lives here.
 */
export function withApi<RouteContext = unknown>(
  handler: ApiHandler<RouteContext>,
  options: { logger?: Logger } = {},
): (request: Request, routeContext: RouteContext) => Promise<Response> {
  const baseLogger = options.logger ?? rootLogger;

  return async (request, routeContext) => {
    const startedAt = performance.now();
    const requestId = resolveRequestId(request.headers);
    const log = baseLogger.child({ requestId });
    // Path only: query strings may carry personal data.
    const path = new URL(request.url).pathname;

    let response: Response;
    try {
      response = await handler(request, { requestId, logger: log }, routeContext);
      if (!response.headers.has(REQUEST_ID_HEADER)) {
        response.headers.set(REQUEST_ID_HEADER, requestId);
      }
    } catch (error) {
      if (isAppError(error)) {
        response = errorResponse(requestId, error);
      } else {
        log.error("Unhandled error while processing request", {
          method: request.method,
          path,
          err: error,
        });
        response = errorResponse(
          requestId,
          new AppError("INTERNAL_ERROR", "An unexpected error occurred."),
        );
      }
    }

    log.info("request completed", {
      method: request.method,
      path,
      status: response.status,
      durationMs: Math.round(performance.now() - startedAt),
    });
    return response;
  };
}
