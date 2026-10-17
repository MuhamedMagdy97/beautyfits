import { logger as rootLogger, type LogFields, type Logger } from "@/server/logging/logger";

/**
 * Error-tracking port (TASK-065, ADR-0073). Unexpected errors (unhandled API
 * errors, failed jobs, render errors) go through `reportError`. The default
 * reporter writes one redacted `error` log line; the vendor is not chosen
 * yet, so a vendor SDK is attached later with `setErrorReporter` without
 * touching callers. `fields` must not contain personal data.
 */
export interface ErrorReport {
  msg: string;
  /** Request- or job-scoped logger (carries `requestId` / `job`). */
  logger?: Logger;
  fields?: LogFields;
}

export type ErrorReporter = (error: unknown, report: ErrorReport) => void;

const logReporter: ErrorReporter = (error, { msg, logger, fields }) =>
  (logger ?? rootLogger).error(msg, { ...fields, err: error });

let reporter: ErrorReporter = logReporter;

export function setErrorReporter(next: ErrorReporter | null): void {
  reporter = next ?? logReporter;
}

/** Reports an unexpected error. Never throws: reporting must not mask the error. */
export function reportError(error: unknown, report: ErrorReport): void {
  try {
    reporter(error, report);
  } catch (reporterError) {
    if (reporter !== logReporter) {
      logReporter(error, report);
    }
    rootLogger.error("Error reporter failed", { err: reporterError });
  }
}
