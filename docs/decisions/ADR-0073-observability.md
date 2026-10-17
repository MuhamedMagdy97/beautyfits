# ADR-0073 — Vendor-neutral observability and job monitoring

- **Status:** Accepted (TASK-065)
- **Date:** 2026-10-18
- **Relates to:** Architecture §25, §27 (monitoring vendor deferred); ADR-0001, ADR-0006, ADR-0013, ADR-0043

## Context

Architecture §25 requires structured logs, error tracking, request correlation ids, background-job logs, audit logs, health checks and database monitoring, without sensitive data in logs. Logs (ADR-0006), request ids, audit logs and liveness/readiness (ADR-0004) exist. The monitoring/error-tracking vendor and hosting are not chosen (§27), and the `npm run jobs:*` scripts only printed a line, so a stuck or missing job was invisible.

## Decision

No new dependency and no vendor SDK.

1. **Job runs.** Every job script calls `runJobScript(name, work)` (`src/server/observability/job-runner.ts`). `runJob` inserts a `job_runs` row (`RUNNING`), runs the work, then sets `SUCCEEDED` with the returned counts or `FAILED` with the error name and redacted message (capped, no stack), and logs one JSON line with `job`, `counts` and `durationMs`. A failure sets exit code 1. The job catalog `JOBS` (name → longest expected gap between successes) is typed, so a new job must be listed to run.
2. **Error-reporting port.** `reportError(error, { msg, logger?, fields? })` (`report-error.ts`) is called for unhandled API errors (`withApi`, with the request-scoped logger, so `requestId` is included), failed jobs, and server render/action errors (`src/instrumentation.ts` `onRequestError`, path without query string, no headers). The default reporter writes one redacted `error` log line. A vendor adapter is attached later with `setErrorReporter(fn)`; if it throws, the log line is still written.
3. **System status.** `GET /api/v1/admin/system-status` reports database reachability, applied/pending/failed migrations (pending = folders in `prisma/migrations` not applied; unknown when the folder is not deployed), due outbox events and the oldest one's age, outbox events FAILED in the last 24 h, the last run and last success of every job, and notification delivery attempts/failures in the last hour, plus alert codes from provisional thresholds (constants in `system-status.ts`). `200` when ok, `503` when degraded or down, so a simple uptime checker can alert on it.
4. **Access.** Staff with `VIEW_AUDIT_LOGS` (Owner/Admin only), reused rather than inventing a permission; or an external monitor with header `X-Monitoring-Token` matching the optional `MONITORING_TOKEN` (≥ 32 characters; compared as SHA-256 digests in constant time). A separate header is used because `Authorization: Bearer` carries staff sessions.

Alert rules and the operator runbook are in `docs/operations/monitoring.md`.

## Consequences

- Choosing a vendor later means one `setErrorReporter` call at startup and log shipping by the platform; callers do not change.
- `job_runs` grows by one row per job run (about 7,000 rows a day if frequent jobs run every minute). Status queries use the `(job_name, started_at DESC)` index. Pruning is left for a later retention job.
- Thresholds are code constants, not settings: changing them is a deploy. They are provisional until production traffic is known.
- Scheduling the jobs, log shipping and paging stay with TASK-066 and the vendor decision.
