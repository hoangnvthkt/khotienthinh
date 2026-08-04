# Project permission Room rollout after Daily Log and material BOQ pilots

This document tracks the cutover after the `daily_log` and `material_planning`
pilots. The source of truth is
`app_private.project_permission_room_action_bindings`; an action may move to
`enforced` only after UI, frontend capability, backend RPC/RLS, database policy,
and allow/deny smoke evidence are all present.

Run `supabase/audits/project_permission_room_action_matrix.sql` before and after
each rollout. Keep `project_room_pbac_fallback_enabled=true` until the audit has
no fallback-only user for the actions being cut over.

## Rollout 1: remaining material workflows

- Rooms: `material_request`, `material_po`, `material_waste`, `custom_material`.
- Confirm owner, assignee, approver, return, fulfillment, stock visibility, and
  status-transition semantics separately. Do not infer `manage`, `confirm`, or
  broad PBAC actions into a narrower Room action.
- Add direct API/RLS allow-deny tests before promoting each action.

## Rollout 2: finance and quality workflows

- Rooms: `quantity_acceptance`, `payment`, `boq_reconciliation`, `quality`.
- Preserve maker/checker/approver separation and document assignment.
- Verify cross-project/site isolation and final-state immutability.

## Rollout 3: schedule workflows

- Rooms: `gantt`, `weekly_progress`.
- Verify edit ownership, completion confirmation, period locking, and approval
  assignment before cutover.

## Rollout 4: safety and subcontract workflows

- Rooms: `safety`, `subcontract`.
- Verify incident/document ownership, closing authority, acceptance, payment,
  and confirmation assignments.

## Completion gate

The Project module cutover is complete only when every registry row is either
`enforced` or removed from the Room contract, there are no fallback-only users,
all unmapped broad grants have an explicit disposition, and
`project_room_pbac_fallback_enabled` is disabled. Rollback for any batch is to
restore the fallback flag and move that batch back to `audit_only`; Room and
backfill evidence remains intact for traceability.
