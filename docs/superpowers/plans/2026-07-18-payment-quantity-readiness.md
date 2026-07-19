# Payment And Quantity Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the existing Payment Certificate and Quantity Acceptance status transitions behind scoped Supabase RPC commands, then collect rollback-only Cloud evidence for the runtime permission codes they actually use.

**Architecture:** Add two security-definer transition functions and matching direct-workflow-field guards. The functions use `app_private.project_has_permission_v2` with project/construction-site scope and preserve submitted-handler assignment checks. Client services call the RPC, then retain existing notification, audit and financial side effects. `project.quantity_acceptance.verify` owns the existing return transition; only `project.payment.mark_paid` lacks a current state owner and stays declared.

**Tech Stack:** PostgreSQL/Supabase migrations, RLS triggers, Supabase RPC, TypeScript, Vitest.

## Global Constraints

- Never edit an applied migration or call `db push`, `migration repair`, local Supabase, or Docker.
- No Cloud mutation without a separately approved, hash-bound Cloud gate.
- Never print identities, URLs, tokens, grant rows, or manifest data.
- Do not Save or preview the 12 principals until every readiness blocker is closed.
- Keep `project.payment.mark_paid` `declared` because it has no current lifecycle step.

---

### Task 1: Lock The Transition Contracts

**Files:**
- Create: `lib/__tests__/paymentQuantityTransitionMigration.test.ts`
- Create: `lib/__tests__/paymentCertificateTransitionService.test.ts`
- Create: `lib/__tests__/quantityAcceptanceTransitionService.test.ts`

**Interfaces:**
- Produces `public.transition_project_payment_certificate_status(uuid,text,text,text,text,text,text)`.
- Produces `public.transition_project_quantity_acceptance_status(uuid,text,text,text,text,text,text)`.

- [x] Write failing static assertions for both RPC signatures, `project_has_permission_v2`, state guards and no readiness/grant/rollout mutation.
- [x] Write failing service assertions that status changes invoke the matching RPC instead of a table update.
- [x] Run the focused Vitest files and confirm they fail because neither RPC exists.

### Task 2: Add Payment Certificate Command

**Files:**
- Create: `supabase/migrations/<timestamp>_payment_quantity_transition_commands.sql`
- Modify: `lib/paymentCertificateService.ts`

**Interfaces:**
- `transition_project_payment_certificate_status` accepts certificate UUID, target status, actor UUID text, reason, submitted target user/permission and submission note.
- Permitted transitions: `draft|returned -> submitted`, `submitted -> returned|approved`, `approved -> paid`, and `approved|paid -> cancelled` with a reason.
- Permission mapping: submit uses `project.payment.submit`; return uses `project.payment.verify`; approve/cancel use `project.payment.approve`; paid uses `project.payment.confirm`.

- [x] Implement the function with row lock, actor identity match, scoped permission/assignee checks, dependency checks for linked acceptance before approval, and workflow metadata updates.
- [x] Add a trigger that rejects direct changes to status and workflow metadata unless the command sets a transaction-local guard.
- [x] Route `paymentCertificateService.setStatus` through the RPC while retaining current audit, notification, advance-recovery and transaction side effects.
- [x] Run focused tests for the payment command. The shared command migration was committed in the local implementation batch; later lifecycle hardening remains uncommitted until the common smoke is verified.

### Task 3: Add Quantity Acceptance Command

**Files:**
- Modify: `supabase/migrations/<timestamp>_payment_quantity_transition_commands.sql`
- Modify: `lib/quantityAcceptanceService.ts`

**Interfaces:**
- `transition_project_quantity_acceptance_status` has the same arguments and return contract as the Payment command.
- Permitted transitions: `draft|returned -> submitted`, `submitted -> returned|approved`, `approved -> cancelled` with a reason.
- Permission mapping: submit uses `project.quantity_acceptance.submit`; return uses `project.quantity_acceptance.verify`; approve/cancel use `project.quantity_acceptance.approve`.

- [x] Implement row lock, actor/assignee/scope checks, mandatory return/cancel reason, paid-payment-certificate rollback block, and workflow metadata updates.
- [x] Add the direct workflow guard and route `quantityAcceptanceService.setStatus` through the RPC while retaining audit and BOQ lock/unlock work.
- [x] Run focused tests for the quantity command. The shared command migration was committed in the local implementation batch; later lifecycle hardening remains uncommitted until the common smoke is verified.

### Task 4: Add Runtime Smoke And Evidence

**Files:**
- Modify: `supabase/tests/phase3_payment_contract_permissions_smoke.sql`
- Modify: `docs/security/phase02-task3-permission-readiness-matrix.md`
- Modify: `docs/security/phase02-business-role-sod-live-apply-log.md`

**Interfaces:**
- The smoke proves intended allow, wrong-scope denial, invalid-state denial and adjacent-action denial for `project.payment.verify`, `project.payment.approve`, `project.payment.confirm`, `project.quantity_acceptance.verify`, and `project.quantity_acceptance.approve`.

- [x] Add transaction-contained disposable fixtures without emitting identities.
- [x] Run static tests and `git diff --check`; commit the smoke separately after the full regression suite.
- [x] Request one Cloud gate that loads the new migration and smoke in an outer `BEGIN`/`ROLLBACK` transaction. Cloud Gate A6R passed, then the transaction rolled back.
- [x] Record only aggregate post-rollback evidence and keep all unproven codes `declared`. Payment Approve and Quantity Approve are evidence-backed `CANDIDATE`; Payment Verify, Payment Confirm and Quantity Verify need a focused follow-up gate.
