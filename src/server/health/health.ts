import type { Logger } from "@/server/logging/logger";

/**
 * Liveness/readiness checks (ADR-0004). Liveness never touches dependencies;
 * readiness reports whether the app can serve traffic (database reachable).
 * Responses expose only coarse status, never connection details.
 */

export type CheckStatus = "up" | "down";

export interface LivenessReport {
  status: "ok";
}

export interface ReadinessReport {
  status: "ready" | "not_ready";
  checks: { database: CheckStatus };
}

export const READINESS_TIMEOUT_MS = 2_000;

export function checkLiveness(): LivenessReport {
  return { status: "ok" };
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export async function checkReadiness(deps: {
  pingDatabase: () => Promise<void>;
  logger: Logger;
  timeoutMs?: number;
}): Promise<ReadinessReport> {
  let database: CheckStatus = "up";
  try {
    await withTimeout(deps.pingDatabase(), deps.timeoutMs ?? READINESS_TIMEOUT_MS);
  } catch (error) {
    database = "down";
    deps.logger.warn("Readiness check failed: database unavailable", { err: error });
  }
  return {
    status: database === "up" ? "ready" : "not_ready",
    checks: { database },
  };
}
