import type { Instrumentation } from "next";
import { reportError } from "@/server/observability/report-error";

/**
 * Next.js server error hook (TASK-065, ADR-0073): errors that escape page
 * rendering, server actions or the proxy go to the same error-tracking port
 * as unhandled API errors (`withApi` handles API errors itself). Only the
 * path without the query string is logged; headers are never logged.
 */
export const onRequestError: Instrumentation.onRequestError = (error, request, context) => {
  reportError(error, {
    msg: "Unhandled server error",
    fields: {
      method: request.method,
      path: request.path.split("?")[0],
      routePath: context.routePath,
      routeType: context.routeType,
    },
  });
};
