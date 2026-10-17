# TASK-065 — Observability & Monitoring

## Goal
Error tracking, structured logs, background job monitoring, key metrics and alerting (roadmap), satisfying Architecture §25 without choosing a vendor.

## Dependencies
TASK-005 (logging/redaction) and the feature tasks that added the `npm run jobs:*` scripts.

## Source of Truth
- Architecture §25 Observability, §27 (monitoring vendor deferred)
- ADR-0001, ADR-0004 (health), ADR-0006 (structured logging), ADR-0013 (`server.mjs`)
- Security Requirements §9 (no sensitive data in logs); permission catalog (`VIEW_AUDIT_LOGS`)

## Scope
1. `job_runs` table and `runJob` / `runJobScript` wrapper used by all eight job scripts.
2. `reportError` port with a log-backed default; used by `withApi` for unhandled API errors and by `src/instrumentation.ts` (`onRequestError`) for render/action errors, and by failed jobs.
3. `GET /api/v1/admin/system-status`: database, migrations, outbox backlog, job runs, notification failure rate, alerts (provisional thresholds as constants).
4. Optional `MONITORING_TOKEN` for external monitors (`X-Monitoring-Token`).
5. Alert rules: `docs/operations/monitoring.md`. ADR-0073.

## Non-Goals
- Vendor SDK, log shipping, paging, dashboards (vendor not chosen).
- Job scheduling (TASK-066); `job_runs` retention/pruning.
- A dashboard screen for system status.

## Files / Modules
- `src/server/observability/{job-runner,report-error,system-status}.ts`, `observability.test.ts`
- `src/app/api/v1/admin/system-status/route.ts`, `system-status-routes.int.test.ts`
- `src/instrumentation.ts`, `src/server/http/route-handler.ts`, `src/server/config/env.ts`, `scripts/*.ts`
- `prisma/schema.prisma`, `prisma/migrations/20261018065000_job_runs`

## Business Rules
None changed. Thresholds are technical and provisional.

## API Changes
`GET /api/v1/admin/system-status` (API contract, "TASK-065 Amendment" under Operational endpoints).

## Database Changes
`job_runs` table and `job_run_status` enum (Database Design "v1.2 TASK-065 Amendments").

## Security / Authorization
- `VIEW_AUDIT_LOGS` (Owner/Admin only) or the monitoring token (≥ 32 chars, constant-time digest comparison, separate header from staff Bearer sessions).
- The response contains counts, timestamps, job names and redacted job error messages only.
- Error reports log the path without query string and never headers; stored job errors are redacted and capped at 1000 characters without stacks.

## Acceptance Criteria
- Every job run produces a `job_runs` row and a JSON log line; failures set exit code 1 and are reported.
- Unhandled API errors are reported with `requestId` through `reportError`; a vendor can be attached via `setErrorReporter`.
- System status returns 200 when healthy and 503 with alert codes when degraded; 401/403 without access.
- Alert rules documented.

## Tests
- Unit: alert evaluation for every code and threshold boundary, monitoring token matching, `reportError` default/attached/failing reporter, job error redaction, env validation.
- Integration: `runJob` success/failure rows; endpoint auth (401, wrong token, Manager 403, Admin and token 200), healthy 200, degraded 503 with five alerts.

## Edge Cases
- A killed job leaves a `RUNNING` row → `JOB_STUCK` until a later run succeeds; a never-run job → `JOB_STALE`.
- Migration folder absent at runtime → `pending: null`, no alert.
- Database down → `status: "down"`, 503, no other sections.
- Outbox events waiting for a retry (`available_at` in the future) do not count as backlog.

## Open Items
- Deferred (owner 2026-10-18): localhost only for now — error-tracking / monitoring vendor and hosting (Architecture §27). Errors stay log lines; attach the chosen SDK with `setErrorReporter`.
- Resolved (owner decision 2026-10-18): keep current behaviour — system status is viewed with `VIEW_AUDIT_LOGS` (Owner/Admin) (BD-074).
- Deferred (owner 2026-10-18): localhost only for now — alert recipients, channel and paging hours (BD-075).
- Provisional thresholds (job windows, 15 min outbox backlog, 30 min stuck job, 20 % notification failure rate over 1 h with ≥ 20 attempts) to be confirmed once job schedules are set in TASK-066.
- `job_runs` retention period (technical; not implemented).

## Definition of Done
Acceptance criteria met, required checks green, docs updated, human review.

## Status
- [x] Planned
- [x] In Progress
- [x] Tests Passing
- [ ] Reviewed
- [ ] Done
