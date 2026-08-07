# Request Workflow Boundary and RQ-2026-000010 Repair Design

## Problem

Request templates publish an internal Workflow template marked by a `custom_fields` entry containing `_requestTemplateId`. Those internal templates and instances currently appear in the generic Workflow module. A reviewer can therefore approve a Request-backed workflow through `process_workflow_instance_fast` instead of `act_on_request`.

The generic Workflow RPC updates `workflow_instances` and `workflow_instance_logs`, but it does not update `request_instances`, `workflow_subjects`, or `workflow_step_assignments`. This produced the live inconsistency for `RQ-2026-000010`: the workflow and activity log are complete while the Request and reviewer assignment remain pending.

## Considered Approaches

### 1. UI filtering only

Hide internal Request templates and instances in Workflow pages. This removes the normal path to the bug but does not prevent a stale client or direct RPC call from mutating the generic workflow.

### 2. Transparently delegate the generic RPC to `act_on_request`

Detect Request-backed workflows and translate generic actions to Request actions. This is rejected because the RPCs have different idempotency, optimistic-concurrency, assignment, notification, and action semantics. Implicit translation would weaken the Request command boundary.

### 3. Explicit module boundary with guarded repair

This is the selected approach. Hide internal Request workflows from generic Workflow surfaces, reject generic workflow actions for every instance linked from `request_instances`, and repair the one known inconsistent Request under strict preconditions.

## UI Boundary

Add a shared predicate that recognizes a Request-owned Workflow template from the `_requestTemplateId` marker in `customFields`. Generic Workflow surfaces must always exclude these templates and their instances, including for system administrators:

- Workflow instance list, filters, and Kanban board
- Workflow template management
- Workflow dashboard and analytics
- Home-page generic Workflow tasks

The Request task remains visible through the Request todo and opens `/rq/:requestId`.

Material-request visibility rules remain unchanged; this change applies only to workflows created by the Request module.

## Backend Boundary

Replace the array-assignee overload of `public.process_workflow_instance_fast` with the current implementation plus an early check after locking the workflow instance:

```sql
if exists (
  select 1
  from public.request_instances request_instance
  where request_instance.workflow_instance_id = p_instance_id
) then
  raise exception using
    errcode = 'P0001',
    message = 'REQUEST_WORKFLOW_USE_REQUEST_MODULE';
end if;
```

The scalar-assignee overload continues delegating to the guarded array overload. Legitimate Request approvals continue exclusively through `public.act_on_request`.

## Production Repair

Repair only request `RQ-2026-000010`, transactionally. The repair must abort unless all these preconditions hold:

- Request status is `PENDING`.
- Subject status is `RUNNING`.
- Workflow status is `COMPLETED`.
- Exactly one pending Request assignment exists.
- The latest `APPROVED` workflow log for the assignment node was created by that assignment's assignee.

When the preconditions pass:

- Set the pending assignment to `APPROVED`, using the existing log timestamp and comment.
- Set the Request to `APPROVED`, with `completed_at` equal to the log timestamp.
- Set the Workflow subject to `COMPLETED`.
- Do not insert a duplicate activity log.
- Leave the already completed Workflow instance unchanged except for consistency-safe timestamps if required.

The migration is general and contains only the backend guard. The production data correction is a separately reviewed one-off query so an environment-specific request code is not embedded in reusable schema history.

## Error Handling

The generic RPC returns `REQUEST_WORKFLOW_USE_REQUEST_MODULE` before inserting a log or mutating workflow state. The UI should not normally expose this path; the database error protects stale clients and direct calls.

The repair uses row locks and explicit assertions. Any mismatch raises an exception and rolls back all changes.

## Verification

- Unit tests recognize `_requestTemplateId` and exclude Request-owned templates/instances from generic Workflow collections.
- A migration contract test proves the generic RPC checks `request_instances` and raises `REQUEST_WORKFLOW_USE_REQUEST_MODULE`.
- TypeScript and production build pass.
- After applying the migration, live function definitions contain the guard.
- A read-only production query confirms `RQ-2026-000010`, its subject, workflow, and assignment are all terminal and no pending Request assignment remains.
- A read-only consistency query confirms no Request-backed workflow is terminal while its Request or assignment remains pending.
