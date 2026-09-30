/**
 * Stable API error codes (docs/api/api-contract.md §29).
 * Clients branch on these codes, never on message text.
 * Adding a code requires updating the API contract first.
 */
export const ERROR_CODES = [
  "UNAUTHENTICATED",
  "AUTH_INVALID_CREDENTIALS",
  "AUTH_OTP_INVALID",
  "AUTH_OTP_EXPIRED",
  "AUTH_EMAIL_NOT_VERIFIED",
  "AUTH_RATE_LIMITED",
  "RATE_LIMITED",
  "FORBIDDEN",
  "NOT_FOUND",
  "VALIDATION_ERROR",
  "CONFLICT",
  "IDEMPOTENCY_CONFLICT",
  "STOCK_CHANGED",
  "OUT_OF_STOCK",
  "PRICE_CHANGED",
  "DISCOUNT_INVALID",
  "DISCOUNT_EXPIRED",
  "SHIPPING_UNAVAILABLE",
  "ORDER_STATE_INVALID",
  "ORDER_CANCELLATION_NOT_ALLOWED",
  "RECONFIRMATION_REQUIRED",
  "RETURN_WINDOW_EXPIRED",
  "RETURN_STATE_INVALID",
  "WALLET_INSUFFICIENT_FUNDS",
  "WALLET_RESERVATION_CONFLICT",
  "PERMISSION_DENIED",
  "APPROVAL_REQUIRED",
  "DUPLICATE_OPERATION",
  "PROVIDER_ERROR",
  "INTERNAL_ERROR",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/**
 * Default HTTP status per error code (API contract §6.1).
 * Typed as a full Record so a new code cannot be added without a status.
 */
export const ERROR_HTTP_STATUS: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  AUTH_INVALID_CREDENTIALS: 401,
  AUTH_OTP_INVALID: 401,
  AUTH_OTP_EXPIRED: 401,
  AUTH_EMAIL_NOT_VERIFIED: 403,
  AUTH_RATE_LIMITED: 429,
  RATE_LIMITED: 429,
  FORBIDDEN: 403,
  PERMISSION_DENIED: 403,
  NOT_FOUND: 404,
  VALIDATION_ERROR: 400,
  CONFLICT: 409,
  IDEMPOTENCY_CONFLICT: 409,
  DUPLICATE_OPERATION: 409,
  STOCK_CHANGED: 409,
  PRICE_CHANGED: 409,
  ORDER_STATE_INVALID: 409,
  RETURN_STATE_INVALID: 409,
  WALLET_RESERVATION_CONFLICT: 409,
  RECONFIRMATION_REQUIRED: 409,
  OUT_OF_STOCK: 422,
  DISCOUNT_INVALID: 422,
  DISCOUNT_EXPIRED: 422,
  SHIPPING_UNAVAILABLE: 422,
  ORDER_CANCELLATION_NOT_ALLOWED: 422,
  RETURN_WINDOW_EXPIRED: 422,
  WALLET_INSUFFICIENT_FUNDS: 422,
  APPROVAL_REQUIRED: 422,
  PROVIDER_ERROR: 502,
  INTERNAL_ERROR: 500,
};

export type ErrorDetails = Record<string, unknown>;

/**
 * Expected, client-safe error. The message and details are returned to the
 * client, so they must never contain secrets or internal data.
 * Anything that is not an AppError is treated as an unexpected failure and
 * returned as INTERNAL_ERROR without its message.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details: ErrorDetails;

  constructor(
    code: ErrorCode,
    message: string,
    options: { details?: ErrorDetails; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "AppError";
    this.code = code;
    this.status = ERROR_HTTP_STATUS[code];
    this.details = options.details ?? {};
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
