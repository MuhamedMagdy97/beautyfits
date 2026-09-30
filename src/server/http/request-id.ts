export const REQUEST_ID_HEADER = "x-request-id";

// Accept a client/proxy-supplied id only if it is short and log-safe.
const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{8,128}$/;

/**
 * Returns the incoming X-Request-Id when it is well-formed, otherwise a new
 * random UUID. The id correlates logs, responses and (later) audit entries.
 */
export function resolveRequestId(headers: Headers): string {
  const incoming = headers.get(REQUEST_ID_HEADER);
  if (incoming && SAFE_REQUEST_ID.test(incoming)) {
    return incoming;
  }
  return crypto.randomUUID();
}
