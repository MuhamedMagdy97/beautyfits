# TASK-001 — Repository & AI Development Rules

## Goal
Create the project-wide rules that every contributor must follow. The official workflow is VS Code + Claude Code + GitHub; Claude Code is the current execution agent and loads the rules via `CLAUDE.md` → `AGENTS.md`. The rules themselves are agent-agnostic.

## Dependencies
None.

## Source of Truth
- `docs/product/business-spec.md`
- `docs/product/user-flows.md`
- `docs/architecture/system-architecture.md`
- `docs/database/database-design.md`
- `docs/api/api-contract.md`
- `docs/tasks/implementation-roadmap.md`
- `docs/tasks/task-template.md`
- `docs/security/security-requirements.md`
- `docs/testing/test-strategy.md`
- `docs/decisions/business-rules-ledger.xlsx` (decision history only)

## Scope
- Create `AGENTS.md` at repository root.
- Define Source-of-Truth precedence.
- Define branch and commit policy.
- Define testing/typecheck/lint expectations.
- Define how an agent handles ambiguity.
- Define documentation update rules.
- Define prohibited behaviors: inventing business rules, bypassing authorization, direct work on `main`, unrelated refactors.
- Correct documentation file names/paths (`business-spec.md`, `business-rules-ledger.xlsx`).
- Merge the Next.js-generated agent guidance into `AGENTS.md` (kept verbatim between its markers so `next dev` does not rewrite the file).
- Add `docs/security/security-requirements.md` and `docs/testing/test-strategy.md`.
- Reconcile known documentation inconsistencies and record final closure decisions (Business Spec R1–R12).
- Add the "Closure & Audit Decisions" worksheet to the decision ledger (R6, R7, R9–R12) without rewriting Q1–Q185.

## Non-Goals
- No application code.
- No database schema changes.
- No API implementation.
- No dependency changes.
- No move of the Next.js app into an `apps/web` monorepo.

## Acceptance Criteria
- A new Claude Code session (or any other agent) can read `AGENTS.md` and understand the workflow.
- The document explicitly points to the `docs/` source-of-truth files.
- The document defines the required checks before a task is considered complete.
- All source-of-truth paths referenced by `AGENTS.md` and the task documents exist.

## Tests
Not applicable; validate by human review of the file.

## Open Items
None. Business decisions raised during TASK-001 were closed as Business Spec R6, R7, R9–R12.

## Definition of Done
- `AGENTS.md` exists in repository root.
- No conflicting rule exists in the task documents.
- Human/product-owner review completed.

## Status
- [x] Planned
- [x] In Progress
- [x] Reviewed
- [x] Done
