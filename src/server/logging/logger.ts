/**
 * Structured JSON logger (ADR-0006).
 *
 * One JSON object per line on stdout/stderr. Sensitive keys are redacted
 * recursively before serialization so passwords, OTPs, tokens, cookies and
 * secrets never reach the logs (docs/security/security-requirements.md §9).
 */

export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

const LEVEL_WEIGHT: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export const REDACTED = "[REDACTED]";

// Matched against object keys, case-insensitively.
const SENSITIVE_KEY =
  /pass(word|phrase)?|otp|token|secret|authorization|cookie|api[-_]?key|session|credential|private[-_]?key|hash|database[-_]?url|connection[-_]?string/i;

const MAX_DEPTH = 8;

export type LogFields = Record<string, unknown>;

export interface Logger {
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
  child(bindings: LogFields): Logger;
}

export type LogWriter = (level: LogLevel, line: string) => void;

const defaultWriter: LogWriter = (level, line) => {
  if (level === "error" || level === "warn") {
    console.error(line);
  } else {
    console.log(line);
  }
};

export function isLogLevel(value: unknown): value is LogLevel {
  return typeof value === "string" && (LOG_LEVELS as readonly string[]).includes(value);
}

export function redact(value: unknown, depth = 0): unknown {
  if (value instanceof Error) {
    return serializeError(value, depth);
  }
  if (value === null || typeof value !== "object") {
    return typeof value === "bigint" ? value.toString() : value;
  }
  if (depth >= MAX_DEPTH) {
    return "[Truncated]";
  }
  if (Array.isArray(value)) {
    return value.map((item) => redact(item, depth + 1));
  }
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    result[key] = SENSITIVE_KEY.test(key) ? REDACTED : redact(item, depth + 1);
  }
  return result;
}

function serializeError(error: Error, depth: number): Record<string, unknown> {
  const serialized: Record<string, unknown> = {
    name: error.name,
    message: error.message,
    stack: error.stack,
  };
  if ("code" in error && typeof error.code === "string") {
    serialized.code = error.code;
  }
  if (error.cause !== undefined && depth < MAX_DEPTH) {
    serialized.cause = redact(error.cause, depth + 1);
  }
  return serialized;
}

export function createLogger(
  options: { level?: LogLevel; bindings?: LogFields; write?: LogWriter } = {},
): Logger {
  const level = options.level ?? "info";
  const bindings = options.bindings ?? {};
  const write = options.write ?? defaultWriter;

  const log = (entryLevel: LogLevel, msg: string, fields?: LogFields) => {
    if (LEVEL_WEIGHT[entryLevel] < LEVEL_WEIGHT[level]) {
      return;
    }
    const entry = redact({ ...bindings, ...fields }) as LogFields;
    write(
      entryLevel,
      JSON.stringify({ time: new Date().toISOString(), level: entryLevel, msg, ...entry }),
    );
  };

  return {
    debug: (msg, fields) => log("debug", msg, fields),
    info: (msg, fields) => log("info", msg, fields),
    warn: (msg, fields) => log("warn", msg, fields),
    error: (msg, fields) => log("error", msg, fields),
    child: (childBindings) =>
      createLogger({ level, write, bindings: { ...bindings, ...childBindings } }),
  };
}

/**
 * Application root logger. LOG_LEVEL is read directly (not through getEnv)
 * so logging keeps working even when other configuration is invalid.
 */
const configuredLevel = process.env.LOG_LEVEL;
export const logger = createLogger({
  level: isLogLevel(configuredLevel) ? configuredLevel : "info",
  bindings: { service: "beautyfits-api" },
});
