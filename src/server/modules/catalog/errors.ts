import { Prisma } from "@/generated/prisma/client";
import { AppError } from "@/server/errors/app-error";

/** Error helpers shared by the catalog services. */

export function conflict(message: string, details: Record<string, unknown>): AppError {
  return new AppError("CONFLICT", message, { details });
}

export function validationError(path: string, code: string, message: string): AppError {
  return new AppError("VALIDATION_ERROR", "Request validation failed.", {
    details: { issues: [{ path, code, message }] },
  });
}

/** A unique-index violation (P2002) naming `column` (or the index name containing it). */
export function isUniqueViolation(error: unknown, column: string): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
    return false;
  }
  return JSON.stringify(error.meta ?? {}).includes(column);
}
