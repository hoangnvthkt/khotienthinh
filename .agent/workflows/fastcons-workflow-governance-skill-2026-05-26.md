---
name: fastcons-workflow-governance
description: Use when implementing or reviewing any FastCons/KhoTienThinh workflow involving draft/submission/approval/return/rejection/completion, user handoff, permissions, delete/rollback, audit history, inventory, cost, payment, or any real-world side effect. This rule ensures every action is traceable, confirmed, status-driven, and constrained by actual downstream usage.
license: private
---

# FastCons Workflow Governance Rule - 2026-05-26

Read this before changing any workflow, approval, deletion, rollback, inventory, cost, payment, or status-transition logic.

The core product pattern is user-to-user workflow: create a draft, submit it to the correct handler, process only at the current step, return for supplement when fixable, reject when not worth continuing, and complete only when downstream reality has happened and been verified.

## Non-Negotiable Principles

1. **Every business action must be traceable**
   - Every create, save draft, submit, approve, return, reject, cancel, delete, close, receive, issue, return goods, rollback, payment action, and admin override must write an audit trail.
   - A deleted document must still leave a tombstone/history record in system activity.
   - Logs must identify: actor, action, document type, document id/code, old status, new status, timestamp, reason/note, and important downstream refs.

2. **Workflow is step-owned**
   - Whoever owns the current step has full authority inside that step.
   - Users must not act in another person's step.
   - UI must hide/disable actions outside the actor's current responsibility.
   - Services/RLS/RPC must enforce the same rule; UI checks are not enough.

3. **Admin is not above reality**
   - Admin may override workflow ownership, clean pending/rejected garbage, and repair stuck states.
   - Admin still cannot undo real-world effects unless the physical/financial state can be reversed.
   - Examples:
     - If goods were received then later consumed/exported, Admin cannot return that receipt unless enough stock remains to reverse.
     - If cost/payment was already used downstream, Admin cannot hard-delete or rollback without reversing or crediting the downstream record first.

4. **All functional actions require a confirm dialog**
   - Use the app's confirm dialog/context, not `window.confirm` or `window.prompt`.
   - Confirm dialog is required for submit, approve, return, reject, cancel, delete, close, complete, receive, issue, payment, rollback, and admin override.
   - Dangerous actions need a clear consequence sentence and a reason field when appropriate.

5. **Status is not enough; downstream state decides**
   - Never rely only on a parent document status to allow delete/rollback.
   - Check active downstream records: transactions, receipts, fulfillment batches, PO links, payment certificates, cost allocations, attachments/evidence, or other domain-specific ledgers.
   - Returned/cancelled downstream records may be historical only, but active records must block destructive actions.

## Standard Lifecycle

Use this lifecycle unless a module has an approved reason to differ:

1. `DRAFT`
   - Creator can edit, delete, and choose when to submit.
   - No approval recipient is required at first creation.
   - Saving draft writes an audit event.

2. `PENDING` / `SUBMITTED`
   - Creator has handed the document to the selected handler.
   - Handler can approve, return, or reject.
   - Creator can view but should not edit unless the document is returned.

3. `RETURNED`
   - Prefer returning the document to `DRAFT` with a visible label like `Bị trả lại`.
   - Keep a return log with reason and the returning actor.
   - The creator may edit and resubmit.

4. `REJECTED`
   - Terminal unless explicitly reopened by an authorized actor.
   - Creator may delete if no downstream operation exists.
   - Admin may delete cleanup records if no downstream operation exists.

5. `APPROVED` / next processing step
   - Ownership moves to the next operational role.
   - Next actor can act only within their step scope.

6. `IN_PROGRESS` / `IN_TRANSIT` / partial states
   - Use ledger/line-level quantities where needed.
   - Parent completion must derive from actual accepted/received/executed quantities, not just planned/ordered/issued quantities.

7. `COMPLETED` / `CLOSED`
   - Document is locked except for explicitly allowed admin corrections.
   - Reversal requires downstream feasibility checks and a compensating ledger/action.

## Delete And Rollback Rules

Before allowing hard delete:

1. Confirm actor is allowed:
   - Creator can delete own `DRAFT`.
   - Creator can delete own `REJECTED` if no downstream operation exists.
   - Admin can delete cleanup states such as `DRAFT`, `PENDING`, `REJECTED` if no active downstream operation exists.

2. Check downstream operations:
   - Active warehouse transactions block delete.
   - Active fulfillment/receipt/issue batches block delete.
   - Active PO links block delete.
   - Active cost/payment/acceptance links block delete.
   - Returned/cancelled historical records may allow deletion only if they no longer represent active quantity/money/evidence.

3. Preserve trace:
   - Write a tombstone/system activity before or atomically with deletion.
   - Include document snapshot or at minimum code, status, actor, reason, and downstream refs.
   - If related historical ledgers remain, detach nullable references only when needed to avoid FK/delete blocks, never erase the ledger.

Rollback rules:

- Prefer compensating actions over deleting history.
- Inventory rollback requires enough current stock in the warehouse being reduced.
- Cost/payment rollback requires enough unapplied/unpaid balance or a reversing credit/adjustment.
- If reality cannot be reversed safely, block the rollback and explain the exact active downstream record.

## Audit Log Standard

Each action should produce both:

1. **Domain log** on the document when the document still exists:
   - `logs[]`, status history table, or equivalent domain ledger.

2. **System activity/audit log** that survives document deletion:
   - `global_activities`, `audit_logs`, or a dedicated immutable table.

Minimum fields:

- `id`
- `module`
- `entityType`
- `entityId`
- `entityCode`
- `action`
- `oldStatus`
- `newStatus`
- `actorUserId`
- `actorName` when available
- `targetUserId` / `targetName` for handoff actions
- `reason` / `note`
- `createdAt`
- `metadata` with downstream refs and compact before/after snapshot

Do not store secrets or tokens in audit metadata.

## Permission Model

Use these layers together:

1. UI visibility:
   - Show actions only when the actor owns the current step or is Admin.

2. Service guard:
   - Re-check role, ownership, status, and downstream state before mutation.

3. Database/RLS/RPC guard:
   - Enforce view/update/delete policies for Supabase tables.
   - RPC status transitions should reject invalid step changes.

Any workflow change that only updates the UI is incomplete.

## Confirm Dialog Standard

Every functional button must open a confirm dialog before mutation.

Dialog content must include:

- action name
- target document code/name
- consequence
- required reason for return/reject/admin override/destructive actions
- countdown for destructive actions where existing app pattern supports it

Use existing app helpers:

- `useConfirm()` for confirm dialogs.
- `useToast()` for result feedback.
- Avoid `window.confirm` and `window.prompt`.

## Implementation Checklist

Before coding:

- Identify the document owner, current step owner, next handler, and Admin exception.
- List every status transition and its allowed actor.
- List downstream ledgers that can block delete/rollback.
- Decide where domain log and surviving system audit log are written.
- Decide what confirm dialog each action needs.

During coding:

- Keep status transition logic centralized in service/RPC/context where possible.
- Do not let a UI button directly bypass service guards.
- Preserve existing working flows and make narrow changes.
- Use line-level ledgers for quantities/money when parent status is not enough.

Before finishing:

- Test allowed actor can act.
- Test wrong actor cannot act.
- Test returned documents go back to editable state with visible returned label.
- Test delete succeeds for clean `DRAFT`/eligible cleanup records.
- Test delete blocks when active downstream records exist.
- Test Admin cannot rollback used inventory/money without enough balance.
- Run `npm run lint` and `npm run build` for TypeScript/UI changes.

## Module Examples

Material request:

- Create request as `DRAFT`.
- Submit chooses handler and moves to `PENDING`.
- Return moves to `DRAFT` with visible `Bị trả lại` label.
- Completion follows actual received quantities, not issued/ordered quantities.
- Delete allowed only when no active fulfillment batch, PO link, or warehouse transaction remains.
- Returned/cancelled batches are historical and may allow cleanup, but their audit trail remains.

PO:

- Workflow actions must happen from opened PO detail, not quick status buttons on card summaries.
- Receiving from supplier updates PO receipt and linked material request ledger.
- Returned/closed PO rollback must check real stock before reducing stock.

Warehouse:

- Any stock decrease must check current on-hand stock.
- Never allow negative stock as a rollback shortcut.
- Use compensating transfer/export/import records instead of deleting transaction history.

Costs/payments:

- Approved/paid/applied amounts are real-world effects.
- Rollback requires a reversing transaction or enough unapplied balance.
- Deleting a source document must not erase payment/cost trace.

## Red Flags

Stop and clarify or redesign when:

- A delete would erase the only proof of who approved/received/paid.
- A status change can skip a required handler.
- Admin override can make stock or money negative.
- UI allows direct mutation without opening the document detail.
- The code checks only parent status and ignores downstream ledgers.
- The action uses browser prompt/confirm instead of the app confirm dialog.
