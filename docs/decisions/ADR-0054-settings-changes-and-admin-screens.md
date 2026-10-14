# ADR-0054 — Settings changes, critical-setting approval and the administration screens

- **Status:** Proposed (TASK-057); the items in §5 wait for the product owner
- **Date:** 2026-10-14
- **Relates to:** ADR-0017 (settings table), ADR-0018 (audit logs, approvals), ADR-0045 (dashboard shell); Business Spec Q70, Q79, Q179–Q181, R7, R19, R37.2; DB Design §20 `setting_history`; API Contract §25, §26; permission catalog §2

Until now settings could only be read (ADR-0017): the bootstrap inserted defaults and nothing changed them. The roadmap gives TASK-057 the settings screen, `setting_history` and the approval of critical settings, plus the dashboard screens for roles, the approval queue and the audit log.

## 1. Changing a setting

- `PATCH /admin/settings/{key}` (`SETTINGS_MANAGE`, Owner/Admin only, Q179) with `{ value, reason? }`. The value must pass the setting's own check in `src/server/modules/settings/settings.ts` (`400 VALIDATION_ERROR`, issue `setting_value_invalid`); an unknown key is `404`.
- The change runs in one transaction under an advisory lock per key, so two changes of one key never interleave (also when no row exists yet).
- The same value as the one in effect changes nothing (`outcome: UNCHANGED`, no history, no audit, no approval request).
- **Non-critical setting:** stored at once (`outcome: APPLIED`).
- **Critical setting (Q180):** a `CRITICAL_SETTING` approval request is opened (entity `SETTING`, entity id = key, `metadata = { key, previousValue, newValue }`); the stored value does not change (`outcome: PENDING_APPROVAL`). One pending request per key (ADR-0018 §4 item 3, `409 APPROVAL_PENDING`).
- **Approval handler** (`criticalSettingApprovalHandler`, registered in `approvals/handlers.ts`): when another Owner/Admin approves, it re-checks under the key lock that the value in effect is still `previousValue` (otherwise `409 SETTING_CHANGED_SINCE` and the request stays pending) and that the new value is still valid, then applies it. A rejection changes nothing.
- Every applied change writes, in the same transaction: the `settings` row (`updated_by_employee_id` = whoever asked for the change), one `setting_history` row (old value in effect, new value, changed by, approved by or null, time; Q181) and one `SETTING_CHANGED` audit entry (actor = the employee who applied it: the requester for a direct change, the approver for a critical one).
- Nobody approves their own request (ADR-0018 §4 item 1), the Owner included. See §5 item 2.

## 2. Which settings are critical

Only settings the documents name as critical are marked `critical`:

| Key | Source |
|---|---|
| `shipping.free_shipping_threshold` | Q180 example "shipping threshold", R37.2 |
| `cod.confirmation_timeout_hours` | Q180 example "COD timeout" |

Q180's other examples (return period, refund policy) and R7's 25% are not settings yet; the returns tasks add them with `critical: true`. All other current keys are non-critical until the product owner decides otherwise (§5 item 1). Changing the flag is one line in `settings.ts`.

## 3. `setting_history`

Table as designed in DB §20, migration `20261014057000_setting_history`. `old_value_json` holds the value in effect before the change (the default when no row was stored). Rows are never changed or deleted by any endpoint. `GET /admin/settings/history` (`SETTINGS_VIEW`) lists them newest first, optionally for one key.

## 4. Administration screens

Real routes under `/staff` replace the TASK-052 placeholders: `/staff/settings`, `/staff/roles`, `/staff/approvals`, `/staff/audit-logs`. They reuse `staffApi`, `useStaffSession`, `StatusPanel` and `errorMessage`; their own texts (Arabic and English) and small shared pieces live in `src/app/staff/(shell)/_admin/kit.tsx`, so the shell's dictionary and navigation are unchanged. Hiding buttons is cosmetic; the API authorizes every call. The employees screen is not part of this task (it stays a placeholder).

## 5. Open business decisions

1. **[BUSINESS DECISION REQUIRED] Which other settings are critical.** Staff session lengths, image limit, minimum margin, guest cart expiry, COD reminder interval/count and COD channel are treated as non-critical (still Owner/Admin only, history and audit). ADR-0023 left the minimum margin to this task; the documents do not decide it.
2. **[BUSINESS DECISION REQUIRED] A store with a single Owner and no Admin cannot change a critical setting**, because nobody approves their own request (ADR-0018 §4 item 1). ADR-0018 allows a feature to let the Owner's own change skip approval; this task does not, because Q180 would then never apply (only Owner/Admin may change settings).
3. **[BUSINESS DECISION REQUIRED] Limits of the staff session settings** (ADR-0017 §5 item 3): still any whole number of minutes above zero.

## Consequences

- New table `setting_history`, new audit action `SETTING_CHANGED`, audit entity type `SETTING`.
- The readers in `settings.ts` are unchanged: a changed value applies on the next read.
- No new dependency.
