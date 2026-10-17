# BeautyFits — Monitoring and Alert Rules

Added by TASK-065 (ADR-0073). Implements Architecture §25. The monitoring/error-tracking vendor is not chosen yet, so every signal below is available as JSON log lines or from one HTTP endpoint; wire them into whatever tool TASK-066 selects.

## Signals

| Signal | Where |
|---|---|
| Structured logs | One JSON object per line on stdout (`info`/`debug`) and stderr (`warn`/`error`), secrets redacted (ADR-0006). |
| Request correlation | `requestId` on every API log line and the `X-Request-Id` response header. |
| Access log | `msg: "request completed"` with `method`, `path` (no query), `status`, `durationMs`. |
| Unhandled errors | `level: "error"`, `msg: "Unhandled error while processing request"` (API, with `requestId`) or `"Unhandled server error"` (pages/actions). All go through `reportError`, where a vendor SDK can be attached. |
| Job runs | `msg: "Job succeeded"` / `"Job failed"` with `job`, `counts`, `durationMs`; plus one `job_runs` row per run. |
| Liveness / readiness | `GET /api/v1/health`, `GET /api/v1/health/ready` (unauthenticated). |
| System status | `GET /api/v1/admin/system-status` (Owner/Admin session, or `X-Monitoring-Token: $MONITORING_TOKEN`). `200` = ok, `503` = degraded or down. |
| Audit logs | `GET /api/v1/admin/audit-logs` (business actions, not monitoring). |

## Alert rules

Thresholds are **provisional** engineering defaults (constants in `src/server/observability/system-status.ts` and `job-runner.ts`), to be tuned once production traffic is known.

| Alert | Raised when | Severity (suggested) | First response |
|---|---|---|---|
| Readiness failing | `/health/ready` returns 503 for 2 consecutive checks (1 min apart) | Page | Database down or unreachable; check the database host and connection limits. |
| `database: "down"` | System status cannot query the database | Page | As above. |
| `MIGRATION_FAILED` | A row in `_prisma_migrations` is unfinished and not rolled back | Page | A deploy failed mid-migration; follow the deployment rollback procedure (TASK-066). |
| `MIGRATIONS_PENDING` | A shipped migration folder is not applied | Ticket (page if it lasts > 15 min after a deploy) | Run `npx prisma migrate deploy`. |
| `JOB_FAILED` | The latest run of a job is `FAILED` | Ticket; page if it repeats 3 runs | Read `job_runs.error` and the `Job failed` log line. |
| `JOB_STUCK` | The latest run is still `RUNNING` after 30 min | Ticket | The process was killed or hangs; check the scheduler. A killed run stays `RUNNING`; the next successful run clears the alert. |
| `JOB_STALE` | No successful run within the job's window: 30 min for `dispatch-notifications`, `deliver-campaigns`, `expire-cod-orders`, `send-cod-reminders`, `notify-restocks`; 3 h for `record-checkout-abandonments`; 26 h for `expire-guest-carts`, `send-wishlist-reminders` (also raised for a job that never ran) | Ticket; page for `dispatch-notifications` and `expire-cod-orders` | Check the scheduler (TASK-066). |
| `OUTBOX_BACKLOG` | The oldest due outbox event waited more than 15 min | Page | `dispatch-notifications` is not running or is failing. |
| `OUTBOX_FAILED_EVENTS` | Any outbox event became `FAILED` in the last 24 h | Ticket | Messages were not delivered after all retries; inspect `outbox_events.last_error`. |
| `NOTIFICATION_FAILURE_RATE` | More than 20 % of delivery attempts in the last hour failed, with at least 20 attempts | Ticket | Provider outage or bad configuration (WhatsApp/email). Fallbacks may still have delivered. |
| Error log rate | More than 10 `level: "error"` lines in 5 min (log-based) | Ticket; page above 50 | Group by `msg` and `requestId`. |
| Latency | p95 of `durationMs` on `request completed` above 2 s for 10 min (log-based) | Ticket | Check slow queries and database load. |

Suggested polling: system status every 5 minutes; readiness every minute.

## Database monitoring

Until a hosting provider is chosen: watch connection count, disk usage, and slow queries (`log_min_duration_statement`) on the PostgreSQL host. The hosting/vendor decision (TASK-066) decides where these metrics come from.

## Privacy

Logs and the status endpoint must not contain customer data: no phone numbers, emails, addresses or message bodies. Redaction (ADR-0006) is a safety net, not permission to log personal data.
