# BeautyFits — AI Development Rules

## Purpose
BeautyFits is a beauty e-commerce platform with one authoritative backend and PostgreSQL database serving the Website, Admin Dashboard, and future Mobile App.

## Development Environment
- Official workflow: **VS Code + Claude Code + GitHub**. Claude Code is the current execution agent; it loads these rules through `CLAUDE.md` (`@AGENTS.md`).
- These rules are agent-agnostic: any AI or human contributor follows them equally.

## Repository Reality
- The repository currently contains a Next.js starter project (`create-next-app`) at the repository root (`src/app`). It is **not** an existing completed BeautyFits website.
- Do not move the Next.js app into an `apps/web` monorepo layout until a task explicitly requires it. The `apps/*` / `packages/*` shape in `docs/architecture/system-architecture.md` is a target, not the current state.
- Next.js in this repo is a recent major version with breaking changes; see the Next.js agent rules block at the end of this file.

## Source of Truth
Read these in order before implementing or changing behavior:
1. `docs/product/business-spec.md`
2. `docs/product/user-flows.md`
3. `docs/architecture/system-architecture.md`
4. `docs/database/database-design.md`
5. `docs/api/api-contract.md`
6. Relevant task file under `docs/tasks/` (task plan: `docs/tasks/implementation-roadmap.md`; new tasks use `docs/tasks/task-template.md`)

Cross-cutting requirements that apply to every task:
- `docs/security/security-requirements.md`
- `docs/testing/test-strategy.md`

`docs/decisions/business-rules-ledger.xlsx` is the decision history/ledger, not the primary implementation source.

When documents conflict, the higher document in the list above wins. Report the conflict instead of silently choosing; if the conflict affects business behavior, stop and mark `[BUSINESS DECISION REQUIRED]`.

## Core Rules
- Never invent or silently change a business rule.
- If a required business decision is missing, stop and mark `[BUSINESS DECISION REQUIRED]`.
- Backend is authoritative. Never trust prices, totals, permissions, stock, discounts, or wallet balances from clients.
- Preserve historical data. Do not hard-delete business records that are referenced by orders, inventory, financial, or audit history.
- Keep Order State, Shipment State, and Return State separate.
- Use transactions for atomic business operations such as checkout and inventory reservation.
- Use idempotency for retryable create/checkout operations.
- All inventory changes must produce inventory movements.
- All wallet changes must produce wallet ledger transactions.
- Important business actions must create audit logs.
- Authorization must be enforced server-side.
- External side effects (email, WhatsApp, shipping providers) must not be required for DB transaction commit; use background jobs/events after successful commit.
- Money is represented as integer minor units (EGP piastres) in the database and API; never use floating point for money.

## Architecture Rules
- Prefer the simplest architecture that satisfies current requirements.
- Use a modular monolith; do not introduce microservices without an explicit documented decision.
- Keep Website, Dashboard, and Mobile as clients of the same backend.
- Do not rewrite or discard the existing Website frontend without a specific task requiring it.
- Keep business logic out of UI components.

## Development Workflow
For every task:
1. Read the task and all referenced source-of-truth documents.
2. Inspect the current code before editing.
3. Write a concise implementation plan.
4. Implement only the task scope.
5. Add/update tests for changed behavior.
6. Run lint/typecheck/tests relevant to the task.
7. Review the diff for security, data integrity, and regressions.
8. Update documentation when behavior or contracts change.
9. Commit the completed task on a feature branch.
10. Do not push directly to `main`.

### Required checks
Until TASK-006 establishes the test harness and CI, run at minimum:
- `npm run lint`
- `npx tsc --noEmit`
- `npm run build` when application code changed

After TASK-006, run the commands defined in `docs/testing/test-strategy.md` and `package.json`.

### Task status
- Update the `## Status` checklist in the task file under `docs/tasks/` as the task progresses (Planned → In Progress → Tests Passing → Reviewed → Done).
- Only the human/product owner marks a task `Reviewed`/`Done` when the task requires human review.
- Record open `[BUSINESS DECISION REQUIRED]` items in the task file rather than resolving them in code.

## Task Boundaries
- Do not combine unrelated tasks for convenience.
- Do not refactor unrelated code unless required for the current task.
- Do not add dependencies without a concrete reason and documenting the decision.
- Do not change public API behavior without updating `docs/api/api-contract.md`.
- Do not change DB structure without updating `docs/database/database-design.md` and the migration plan.

## Security
- Never commit secrets, credentials, tokens, or production `.env` files.
- Validate and authorize every server-side input.
- Apply rate limiting to authentication and other abuse-prone operations.
- Treat uploaded files as untrusted input.
- Avoid logging passwords, OTP values, session tokens, payment secrets, or unnecessary sensitive customer data.
- Full requirements: `docs/security/security-requirements.md`.

## Git Rules
- `main` is protected/release-oriented.
- Use feature branches named like `feature/TASK-001-repo-ai-rules` or `fix/TASK-123-...`.
- Commits should be small and describe the task outcome.
- Do not rewrite shared history unless explicitly required.

## Completion Standard
A task is not complete until:
- Acceptance criteria are satisfied.
- Relevant tests pass.
- Lint/typecheck pass where applicable.
- No obvious security/data-integrity regression is introduced.
- Required documentation is updated.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
