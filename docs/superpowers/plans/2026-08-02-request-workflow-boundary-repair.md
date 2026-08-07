# Request Workflow Boundary Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent Request-owned workflow instances from being processed by the generic Workflow module and reconcile the single inconsistent live request `RQ-2026-000010`.

**Architecture:** A shared frontend predicate recognizes internal Request templates by their `_requestTemplateId` marker and removes them from every generic Workflow collection. A database guard rejects generic workflow actions for any instance referenced by `request_instances`. A separate, assertion-heavy one-off script repairs the known live record without embedding production identifiers in schema migrations.

**Tech Stack:** React 19, TypeScript, Vitest, PostgreSQL PL/pgSQL, Supabase CLI.

## Global Constraints

- Work directly on `feature/amazon-vendor-po`; do not create a worktree.
- Preserve the unrelated `supabase/.temp/cli-latest` modification.
- Request approvals must continue exclusively through `public.act_on_request`.
- Internal Request workflows must never appear on generic Workflow surfaces, including for system administrators.
- Production repair must affect only `RQ-2026-000010` and abort on any unexpected state.

---

### Task 1: Hide Request-Owned Workflows From Generic Workflow Surfaces

**Files:**
- Modify: `lib/workflowVisibility.ts`
- Create: `lib/__tests__/workflowVisibility.test.ts`
- Modify: `pages/wf/WorkflowInstances.tsx`
- Modify: `pages/wf/WorkflowTemplates.tsx`
- Modify: `pages/wf/WorkflowDashboard.tsx`
- Modify: `pages/Home.tsx`

**Interfaces:**
- Produces: `isRequestModuleWorkflowTemplate(template): boolean`, recognizing `_requestTemplateId` in `customFields`.
- Consumes: existing `isMaterialRequestWorkflowTemplate` and `canSeeMaterialRequestWorkflowOnKanban` behavior without changing material-request access.

- [ ] **Step 1: Write the failing predicate tests**

```ts
expect(isRequestModuleWorkflowTemplate({ customFields: [
  { _requestTemplateId: 'template-1' },
] } as never)).toBe(true);
expect(isRequestModuleWorkflowTemplate({ customFields: [] } as never)).toBe(false);
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm test -- lib/__tests__/workflowVisibility.test.ts`

Expected: FAIL because `isRequestModuleWorkflowTemplate` is not exported.

- [ ] **Step 3: Implement the marker predicate**

Add a null-safe scan of `template.customFields` that returns true only when an object contains a non-empty string `_requestTemplateId`.

- [ ] **Step 4: Apply the predicate to all generic collections**

Exclude Request-owned templates from template management, dashboard, instance list, instance filters, Kanban, and Home generic Workflow todos. Preserve the existing admin exception only for the material-request workflow.

- [ ] **Step 5: Run focused tests and type checking**

Run: `npm test -- lib/__tests__/workflowVisibility.test.ts`

Run: `npm run lint`

Expected: both commands exit 0.

- [ ] **Step 6: Commit the frontend boundary**

```bash
git add lib/workflowVisibility.ts lib/__tests__/workflowVisibility.test.ts pages/wf/WorkflowInstances.tsx pages/wf/WorkflowTemplates.tsx pages/wf/WorkflowDashboard.tsx pages/Home.tsx
git commit -m "fix(requests): hide internal workflows from workflow module"
```

### Task 2: Reject Generic Actions on Request-Owned Workflow Instances

**Files:**
- Create: `lib/__tests__/requestWorkflowBoundaryMigration.test.ts`
- Create: `supabase/migrations/20260802153500_guard_request_owned_workflow_actions.sql`

**Interfaces:**
- Produces: the existing `public.process_workflow_instance_fast(uuid, workflow_instance_action, uuid, text, uuid[])` signature with an early Request ownership guard.
- Error contract: PostgreSQL `P0001` with message `REQUEST_WORKFLOW_USE_REQUEST_MODULE`.
- Consumes: `request_instances.workflow_instance_id` and the scalar overload's existing delegation to the array overload.

- [ ] **Step 1: Write the failing migration contract test**

Assert that the migration exists, replaces the array overload, checks `public.request_instances` by `workflow_instance_id`, raises `REQUEST_WORKFLOW_USE_REQUEST_MODULE` before inserting `workflow_instance_logs`, preserves execute grants, and reloads the PostgREST schema.

- [ ] **Step 2: Run the focused contract test and verify RED**

Run: `npm test -- lib/__tests__/requestWorkflowBoundaryMigration.test.ts`

Expected: FAIL because the migration does not exist.

- [ ] **Step 3: Create the deterministic migration**

Copy the latest array-overload implementation from `20260616112000_workflow_instance_detail_comments_multi_assignees.sql`, insert this check immediately after locking and finding the instance, and preserve the current return type and privileges:

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

- [ ] **Step 4: Run focused tests and inspect the SQL diff**

Run: `npm test -- lib/__tests__/requestWorkflowBoundaryMigration.test.ts`

Run: `git diff --check`

Expected: both commands exit 0 and the guard precedes log insertion.

- [ ] **Step 5: Commit the backend boundary**

```bash
git add lib/__tests__/requestWorkflowBoundaryMigration.test.ts supabase/migrations/20260802153500_guard_request_owned_workflow_actions.sql
git commit -m "fix(requests): guard internal workflow actions"
```

### Task 3: Build the Guarded One-Off Repair

**Files:**
- Create: `lib/__tests__/requestWorkflowRepairScript.test.ts`
- Create: `scripts/repair-rq-2026-000010.sql`

**Interfaces:**
- Produces: an idempotency-safe, single-request PL/pgSQL repair block.
- Consumes: the existing `APPROVED` log as the source of actor, timestamp, and comment.

- [ ] **Step 1: Write the failing repair contract test**

Assert that the script targets the exact code once, locks Request/subject/workflow/assignments, validates `PENDING`/`RUNNING`/`COMPLETED`, requires exactly one pending assignment, matches the log actor to the assignee, updates assignment/Request/subject terminal states, and never inserts a workflow log.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm test -- lib/__tests__/requestWorkflowRepairScript.test.ts`

Expected: FAIL because the repair script does not exist.

- [ ] **Step 3: Implement the one-off repair block**

Use `SELECT ... FOR UPDATE`, explicit `P0001` assertions, and the existing log timestamp/comment. Set assignment `APPROVED`, Request `APPROVED`, and subject `COMPLETED`; do not duplicate the activity log.

- [ ] **Step 4: Run the focused repair test**

Run: `npm test -- lib/__tests__/requestWorkflowRepairScript.test.ts`

Expected: exit 0.

- [ ] **Step 5: Commit the repair script**

```bash
git add lib/__tests__/requestWorkflowRepairScript.test.ts scripts/repair-rq-2026-000010.sql
git commit -m "fix(requests): add guarded repair for RQ-2026-000010"
```

### Task 4: Apply and Verify Production Changes

**Files:**
- Use: `supabase/migrations/20260802153500_guard_request_owned_workflow_actions.sql`
- Use: `scripts/repair-rq-2026-000010.sql`

**Interfaces:**
- Produces: a guarded live generic Workflow RPC and a consistent live Request record.

- [ ] **Step 1: Run the full local verification suite**

Run: `npm test -- lib/__tests__/workflowVisibility.test.ts lib/__tests__/requestWorkflowBoundaryMigration.test.ts lib/__tests__/requestWorkflowRepairScript.test.ts lib/__tests__/routeAccess.test.ts lib/__tests__/permissionService.test.ts`

Run: `npm run lint`

Run: `npm run build`

Expected: all commands exit 0.

- [ ] **Step 2: Re-read live preconditions**

Query `RQ-2026-000010` and abort if its Request, subject, workflow, assignment, or approval log differs from the design preconditions.

- [ ] **Step 3: Apply only the new guard migration**

Run: `npx supabase db query --linked -f supabase/migrations/20260802153500_guard_request_owned_workflow_actions.sql`

Then mark only version `20260802153500` applied if the linked migration ledger requires repair rather than a safe `db push`.

- [ ] **Step 4: Verify the live function guard**

Use `pg_get_functiondef` to confirm the array overload contains both `request_instances` and `REQUEST_WORKFLOW_USE_REQUEST_MODULE`.

- [ ] **Step 5: Execute the guarded repair**

Run: `npx supabase db query --linked -f scripts/repair-rq-2026-000010.sql`

Expected: one successful transaction; any assertion error means no data is changed.

- [ ] **Step 6: Verify live consistency**

Confirm `RQ-2026-000010` is `APPROVED`, its subject and workflow are `COMPLETED`, its assignment is `APPROVED`, and zero pending assignments remain. Run the cross-table inconsistency query and expect zero affected Requests.

- [ ] **Step 7: Record final repository state**

Run: `git status --short --branch`

Expected: branch contains only the preserved unrelated `supabase/.temp/cli-latest` modification and is ahead of its remote.
