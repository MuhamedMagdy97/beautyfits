import { AppError } from "@/server/errors/app-error";
import { withApi } from "@/server/http/route-handler";

/**
 * Fallback for unknown /api/v1 paths so API clients always receive the
 * standard error envelope instead of an HTML 404 page.
 */
const notFound = withApi(async () => {
  throw new AppError("NOT_FOUND", "The requested API endpoint does not exist.");
});

export {
  notFound as GET,
  notFound as POST,
  notFound as PUT,
  notFound as PATCH,
  notFound as DELETE,
};
