/**
 * Starts `count` calls of `fn` at once and waits for every one of them, for
 * race tests (TASK-062). Rejections are returned, not thrown. Test-only.
 */
export function concurrently<T>(
  count: number,
  fn: (index: number) => Promise<T>,
): Promise<PromiseSettledResult<T>[]> {
  return Promise.allSettled(Array.from({ length: count }, (_, index) => fn(index)));
}

/** The values of the calls that succeeded. */
export function fulfilled<R extends PromiseSettledResult<unknown>>(
  results: readonly R[],
): Extract<R, { status: "fulfilled" }>["value"][] {
  return results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
}

/** The errors of the calls that failed. */
export function rejected(results: readonly PromiseSettledResult<unknown>[]): unknown[] {
  return results.flatMap((r) => (r.status === "rejected" ? [r.reason] : []));
}
