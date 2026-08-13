# Gantt Room Authoritative Cutover Design

## 1. Purpose

Cut over the Project permission Room `gantt` (Tiến độ) to the same
authoritative Room model already proven by Nhật ký công trường, Đơn hàng PO,
Đề xuất vật tư, and Chốt tiến độ ngày/tuần.

The module and tab permissions open the Project shell. They do not grant access
to schedule data or schedule operations. The exact project/construction-site
Room is the sole business authorization source.

The `gantt` Room exposes exactly three independent actions:

- `view`: view schedule data.
- `edit`: create and change schedule data and all non-destructive schedule
  operations.
- `delete`: delete a schedule task when its dependency policy permits deletion.

The existing completion-request workflow is removed from the product runtime.
Historical completion-request rows remain in the database and are not deleted,
displayed by product UI, or exposed for authenticated client operations.

## 2. Approved Decisions

### 2.1 Three-action Room

Change the TypeScript and database Room registries to:

| Action | Vietnamese label | Scope |
| --- | --- | --- |
| `view` | Xem | Read WBS, Gantt, baseline, delay events, forecast history, and schedule-related links. |
| `edit` | Sửa | Create, edit, duplicate, assign, import, reorder, update progress, create a baseline, manage delay events, apply a forecast, and replace task–BOQ links. |
| `delete` | Xóa | Delete an eligible task and the eligible descendant set selected by the existing delete behavior. |

Prerequisites:

- `edit` requires `view`.
- `delete` requires `view`.
- `delete` does not require `edit`.

Set `required_actions` to an empty array. Tiến độ no longer has a workflow
recipient requirement.

Remove `submit`, `verify`, and `approve` from the `gantt` Room whitelist,
bindings, Room membership grants, Room editor, UI capability checks, and new
backfills.

### 2.2 `edit` includes all non-destructive schedule operations

Do not expose separate Room actions for create task, edit task, assignment,
baseline, import, delay-event handling, or forecast application. They are all
schedule edits and require `gantt.edit`.

`edit` does not imply hard deletion. Removing or replacing child association
rows as part of an edit transaction, such as replacing task–BOQ links, is an
edit operation rather than a `gantt.delete` operation.

### 2.3 Remove the completion workflow from Tiến độ

Remove all completion-workflow behavior from `GanttTab`, including:

- Loading `project_task_completion_requests` for the Tiến độ workspace.
- Creating or updating a completion request.
- Submit, technical verification, approve, reject, return, or cancellation
  controls.
- Completion-request panels, dialogs, status badges, approval queues,
  notifications, and Room recipient lookups.
- The task gate submit/approve/reject controls and gate-based predecessor
  blocking in the Tiến độ UI.
- Progress derivation from completion requests in the Tiến độ workspace.

Audit and remove the same retired workflow from other runtime consumers,
including dashboard approval queues, executive schedule derivation, active
notifications/deep links, and user-facing metrics. No product surface may
continue to present a completion request as actionable or use it to recompute
current task progress.

The historical table `project_task_completion_requests` and its rows remain
unchanged. The table is archival for this cutover: authenticated clients lose
direct `SELECT`, `INSERT`, `UPDATE`, and `DELETE` privileges, and this feature
introduces no replacement completion-request query or command. Controlled
service-role support and migration access remain available.

Existing tasks with `progress_mode = 'completion_request'` retain their
persisted `progress` value and are converted to `progress_mode = 'manual'`.
This freezes the last known result while allowing future changes through
`gantt.edit`. Existing gate columns and values remain stored for historical
traceability but are not used or displayed by the new Tiến độ behavior.

Deleting a task is denied when any historical completion request references the
task. This prevents the current `ON DELETE CASCADE` foreign key from destroying
archival data.

### 2.4 Administrative override

An active System Admin keeps the existing operational actor override. The
override:

- Does not create a Room membership row.
- Does not make the admin a workflow recipient.
- Does not alter Room health or backfill counts.
- Is enforced only by the shared effective Room-action helper.

Non-admin actors must have an active, exact-scope project staff relationship and
the requested active Room action.

## 3. Data Surface

### 3.1 Authoritative schedule tables

The cutover covers every table directly written by the Tiến độ workspace:

- `project_tasks`
- `project_baselines`
- `project_delay_events`
- `project_schedule_revisions`
- `project_schedule_revision_tasks`
- `task_contract_items`

Reads of these tables require effective `gantt.view` in the row's exact
project/site scope. Child tables authorize through their parent task or
revision and cannot widen the parent's scope.

The cutover also changes client access to
`project_task_completion_requests`: its rows remain preserved, but Tiến độ no
longer reads or writes them and no other product runtime exposes them.

Add `updated_at timestamptz not null default now()` and
`row_version bigint not null default 1` to `project_tasks`. A database trigger
updates `updated_at` and increments `row_version` on every task update,
including trusted system progress updates. These columns provide one fixed
optimistic-concurrency contract for every schedule command.

### 3.2 System-owned progress updates

The following approved sources may continue to update derived task progress:

- Chốt tiến độ ngày/tuần.
- Nhật ký công trường.
- Nghiệm thu khối lượng.
- Parent-task rollups and other existing database-owned derivations.

These updates run through narrow private system routines. They do not grant the
human actor `gantt.edit`, do not use browser table mutations, and must preserve
the source Room's own authoritative permission and state checks.

### 3.3 Read consumers outside Tiến độ

Dashboards, finance calculations, material planning, reports, and AI/database
tools that need schedule aggregates must not receive broad task rows merely
because their user lacks `gantt.view`.

Each consumer must use one of the following:

1. A minimal, security-definer aggregate RPC authorized by the consumer's own
   module/Room contract.
2. A trusted system-owned path with a fixed projection.
3. Direct task reads only when the actor has `gantt.view`.

This prevents tightening `project_tasks` RLS from breaking legitimate
cross-module aggregates or motivating a permissive read policy.

## 4. Authorization Model

### 4.1 Room bindings

Record these bindings in
`app_private.project_permission_room_action_bindings`:

| Room action | Legacy PBAC compatibility codes | Prerequisite | Cutover fallback |
| --- | --- | --- | --- |
| `view` | `project.gantt.view`; legacy `project_staff_permissions` code `view` used by Gantt | none | disabled after backfill verification |
| `edit` | `project.gantt.create_task`, `project.gantt.edit_task`, `project.gantt.assign_task`, `project.gantt.edit`, `project.gantt.manage`; legacy staff code `edit` | `view` | disabled after backfill verification |
| `delete` | Legacy `project_staff_permissions` code `delete` used by Gantt | `view` | disabled after backfill verification |

Do not map these obsolete completion codes:

- `project.gantt.submit_completion`
- `project.gantt.verify_completion`
- `project.gantt.approve_completion`

Do not infer `delete` from any edit or manage grant. The current PBAC namespace
has no `project.gantt.delete` action; therefore delete backfill comes only from
an active exact-scope legacy `project_staff_permissions` `delete` row. If that
row does not exist, no delete Room grant is backfilled.

The legacy PBAC definitions and historical grants may remain for audit and
compatibility reporting, but new consumers and Room backfills do not use the
obsolete completion codes.

### 4.2 Effective action check

All commands use the existing shared effective helper:

`app_private.project_actor_has_effective_room_action(actor, project, site, 'gantt', action)`

The helper must require:

- A resolved, active application actor.
- A valid Room/action binding.
- An active exact-scope staff relationship for non-admin actors.
- An active Room membership and action grant.
- Every configured prerequisite action.
- No PBAC fallback for the three cut-over actions.

Module, submodule, tab-admin, task ownership, assignee, watcher, old PBAC, or
participation alone never grants a `gantt` action.

### 4.3 Exact scope

Every command accepts both `project_id` and nullable `construction_site_id` and
derives a canonical scope. The database validates that:

- The project exists.
- A supplied site belongs to that project.
- Every task, baseline, delay event, revision, revision task, contract item,
  and link in the payload belongs to the same scope.
- IDs from another project or construction site are rejected before any write.
- A Room membership with `construction_site_id is null` keeps the existing
  documented meaning "applies to the whole project" and may authorize rows in
  any site of that project.
- A site-specific Room membership authorizes only that exact site and never a
  different site or project-wide rows.
- Multiple site-specific memberships are evaluated independently and are not
  combined into a project-wide grant.

## 5. Authoritative Command API

Authenticated browser clients have read-only Data API access to the schedule
tables under RLS. All writes go through public security-invoker wrappers backed
by private security-definer commands with an empty `search_path`.

The public command surface is fixed as:

- `public.save_project_gantt_tasks`
- `public.delete_project_gantt_task_tree`
- `public.replace_project_gantt_task_contract_items`
- `public.create_project_gantt_baseline`
- `public.transition_project_gantt_delay_event`
- `public.apply_project_gantt_forecast`

Each command accepts a caller-generated `request_id uuid` used as an
idempotency key, the exact project/site scope, and its operation payload.

### 5.1 Save tasks

Provide a bulk-capable save command used by:

- Create, edit, and duplicate.
- Inline manual-progress update.
- Drag/resize and ripple changes.
- Sandbox application.
- Excel create/update import.
- Parent rollups caused by an authorized schedule edit.

The command requires `gantt.edit` and, in one transaction:

1. Resolves and validates actor and exact scope.
2. Validates every task payload and task ID.
3. Requires `expected_row_version` for every existing task; new tasks use a
   null expected version.
4. Validates WBS uniqueness, parent hierarchy, dependency IDs, date rules,
   progress rules, and allowed progress modes.
5. Rejects client attempts to mutate archived gate workflow fields.
6. Inserts or updates tasks.
7. Applies deterministic schedule derivations that belong to the same command.
8. Writes a permission/business audit event with changed task IDs and a compact
   before/after summary.
9. Returns the authoritative changed rows and their new row versions in a
   deterministic result envelope.

The client must not loop over individual REST upserts for bulk operations.

### 5.2 Delete task tree

Provide a task-deletion command requiring `gantt.delete`.

The command receives the selected root task and its `expected_row_version`. It
computes the descendant set in the database and locks it before continuing:

1. Validates exact scope and `gantt.delete` plus `view` prerequisite.
2. Rejects deletion if any affected task has a historical completion request.
3. Evaluates all existing document dependencies and protected task states.
4. Rejects deletion when a child or related document cannot be safely removed.
5. Removes eligible task-owned links and repairs surviving dependency
   references atomically.
6. Deletes only the approved root/descendant set.
7. Writes one audit event describing the full deletion set.

The browser may show a dependency preview, but only the database result is
authoritative.

### 5.3 Replace task–BOQ links

Provide a command requiring `gantt.edit` that replaces the contract-item links
for one task atomically. It validates that the task and every contract item
belong to the same project/site scope. An empty list is a valid replacement.

Task saving and link replacement must be combined by
`save_project_gantt_tasks` when submitted from the same edit form so a task
cannot save while its link change fails. The standalone replacement command is
reserved for a link-only edit surface and uses the same authorization, scope,
version, idempotency, and audit contract.

### 5.4 Create baseline

Provide a baseline command requiring `gantt.edit`. In one transaction it:

- Locks the current authoritative task projection as a snapshot.
- Creates the baseline row.
- Updates baseline fields on the affected tasks.
- Returns the baseline and updated task rows.
- Records the actor, scope, and affected task count.

The browser does not construct an independently trusted snapshot.

### 5.5 Change delay-event status

Provide a command requiring `gantt.edit`. It validates the event transition,
source event scope, actor metadata, and timestamps. It must reject invalid
status transitions instead of accepting arbitrary client patches.

### 5.6 Apply forecast revision

Provide one command requiring `gantt.edit` that atomically:

- Validates the selected delay events and current task versions.
- Recalculates or validates the proposed forecast changes.
- Creates the schedule revision.
- Creates its revision-task rows.
- Updates all affected tasks.
- Marks the consumed delay events as applied.
- Writes one audit event.

A partial revision, partially updated task set, or partially applied event set
must never be committed.

## 6. RLS, Grants, and Database Guards

### 6.1 Read policies

Replace permissive schedule policies with scoped `SELECT` policies requiring
effective `gantt.view`:

- `project_tasks` checks its own project/site scope.
- `project_baselines`, `project_delay_events`, and
  `project_schedule_revisions` check their own scope.
- `project_schedule_revision_tasks` checks the parent revision and referenced
  task scope.
- `task_contract_items` checks the parent task scope and does not grant access
  to full contract data beyond the minimal linked projection.

Keep the shared active-actor restrictive policies.

### 6.2 Mutation privileges

Revoke direct `INSERT`, `UPDATE`, and `DELETE` privileges from `authenticated`
on all authoritative schedule tables. Grant only the minimum wrapper execution
privileges.

Revoke all authenticated table privileges, including `SELECT`, on
`project_task_completion_requests`. Service-role maintenance remains available
for controlled support operations, migrations, and archival handling. No
authenticated archival RPC is added by this cutover.

### 6.3 Guards against alternate paths

Private commands and triggers must prevent:

- Direct mutation of gate workflow fields by the new task-save command.
- Scope-column reassignment.
- Cross-scope parent, dependency, task–BOQ, revision, or delay-event links.
- Calling a private function directly as `authenticated`.
- A legacy REST client bypassing Room authorization.

Existing trusted system routines that update derived progress remain separate,
narrow, and explicitly granted. Their definitions and execute grants are
snapshotted before the cutover.

## 7. Frontend Design

### 7.1 Capability loading

`GanttTab` loads `get_my_project_room_actions` for Room `gantt` and derives:

- `canViewSchedule`
- `canEditSchedule`
- `canDeleteSchedule`

It does not call project PBAC checks and does not infer actions from
`canManageTab`. The parent route may still use module/tab permission to open the
shell, but `GanttTab` independently enforces Room capabilities.

During capability loading, mutation controls remain disabled. A failed
capability load fails closed and offers retry.

### 7.2 UI states

- Without `view`: do not issue schedule data queries; render a clear no-access
  state.
- With `view` only: show all authorized schedule views as read-only; hide or
  disable every mutation control with a consistent explanation.
- With `edit`: enable all non-destructive schedule operations.
- With `delete`: enable eligible task deletion independently of `edit`.
- With `delete` but without `edit`: the actor may delete an eligible task but
  cannot change or import data.

Use stable Vietnamese messages:

- `Bạn không có quyền Xem trong Room Tiến độ.`
- `Bạn không có quyền Sửa trong Room Tiến độ.`
- `Bạn không có quyền Xóa trong Room Tiến độ.`
- `Không thể xóa hạng mục vì có dữ liệu lịch sử hoặc hồ sơ liên quan.`
- `Dữ liệu Tiến độ đã thay đổi. Vui lòng tải lại và thử lại.`

Do not display raw PostgreSQL, RLS, constraint, or English authorization errors.

### 7.3 Removed UI and code

Remove from the Tiến độ bundle and component state:

- `taskCompletionRequestService` usage.
- Completion request state, maps, handlers, dialogs, panels, recipient
  notifications, and status counters.
- Submit/verify/approve permission constants and hints.
- Gate action modal/panel and predecessor gate-blocking controls.
- Completion-request-derived progress labels and edit restrictions.

Historical completion-request data is not exposed through a hidden panel or
fallback query.

Remove completion requests and gate workflow state from other user-facing
runtime consumers as well. Dashboard queues, executive views, notification
routes, and metrics must stop treating historical rows or gate values as an
active workflow. Database-only archival references, migration tests, and
service-role support tooling may remain.

### 7.4 Service layer

Replace direct schedule table mutations in frontend services with the new
command RPCs. Read methods may continue using RLS-protected selects.

Bulk commands send one validated payload and invalidate the task cache only
after a successful response. On failure, the UI retains the user's draft and
reloads authoritative data only when required by a concurrency conflict.

## 8. Migration and Backfill

### 8.1 Registry cleanup

In one migration:

1. Change `project_permission_rooms.gantt.allowed_actions` to
   `['view', 'edit', 'delete']`.
2. Set `required_actions` to an empty array.
3. Delete obsolete `submit`, `verify`, and `approve` Room member-action rows.
4. Delete their `gantt` binding rows.
5. Upsert the three approved bindings and prerequisites.

Deleting obsolete Room grants does not delete PBAC audit history or completion
request data.

### 8.2 Safe-union legacy permission backfill

Backfill only when all conditions hold:

- The user is active and non-admin.
- The source is either an active, unexpired project/site
  `user_permission_grants` Gantt PBAC row or an active
  `project_staff_permissions` row attached to the same active staff record.
- The source scope is exactly one project or construction site.
- Exactly one active non-admin `project_staff` row matches a PBAC grant scope;
  a staff-permission source uses its own staff row and scope directly.
- The source code is one of the approved view/edit/delete mappings in section
  4.1.

For every converted `edit` or `delete`, add `view`. Merge with existing Room
grants without removing manual grants. Preserve `manual_room`; label only newly
converted actions as `pbac_backfill`.

Ambiguous, inactive, global, expired, completion-only, and unmatched grants are
reported but not converted. The backfill audit records the source table and
source row identifier for every converted action.

### 8.3 Freeze legacy completion-driven tasks

Before removing completion-derived behavior:

1. Snapshot counts and values for tasks with
   `progress_mode = 'completion_request'`.
2. Preserve each task's current `progress` and actual dates.
3. Change only its `progress_mode` to `manual`.
4. Leave completion-request rows and gate metadata unchanged.
5. Record an audit event with affected task IDs/counts and the migration source.

The migration must be idempotent and must not recompute historical progress.

### 8.4 Disable fallback

After dry-run and backfill verification, set `pbac_fallback_enabled = false`
for `gantt.view`, `gantt.edit`, and `gantt.delete` in the same release. New
PBAC-only grants must not restore access.

Keep all three bindings at `pilot` during acceptance. Promote them to
`enforced` only after the Cloud smoke suite and business acceptance pass.

## 9. Error Handling and Concurrency

Commands return a stable code/message contract for at least:

- Missing or inactive actor.
- Missing Room action or prerequisite.
- Invalid project/site scope.
- Cross-scope payload.
- Invalid WBS, hierarchy, dependency, date, progress, or status transition.
- Protected dependency or historical completion request.
- Stale task/revision state.
- Duplicate command/idempotency conflict.

Bulk task, baseline, link, and forecast commands are all-or-nothing. Existing
task mutations compare `expected_row_version` under row lock; any mismatch
rejects the complete command. Retrying a completed `request_id` returns the
stored result and must not duplicate a baseline, revision, audit event, or
task.

## 10. Audit Contract

Record immutable audit events for:

- Task create/update/import/bulk schedule change.
- Task-tree deletion and blocked deletion.
- Baseline creation.
- Task–BOQ link replacement.
- Delay-event transition.
- Forecast revision application.
- PBAC-to-Room backfill.
- Legacy completion-driven task freeze.

Each event includes actor, project, construction site, Room/action, operation,
affected IDs/count, timestamp, outcome, and compact metadata. Avoid storing
entire large import payloads or sensitive attachment contents.

## 11. Verification

### 11.1 Contract and frontend tests

Add tests proving:

- The `gantt` Room exposes only `view`, `edit`, and `delete`.
- `edit` and `delete` require `view`.
- `GanttTab` uses Room capabilities and no project PBAC fallback.
- A no-view actor does not query schedule tables.
- A view-only actor cannot invoke any command.
- Edit and delete remain independent.
- Completion request and gate workflow UI/service calls are absent.
- Dashboard, executive, notification, and metric consumers no longer expose or
  recompute from the retired completion workflow.
- RPC failures retain drafts and render Vietnamese messages.

### 11.2 SQL smoke tests

Test at least these actors and scopes:

- Active Room-only viewer, editor, and deleter.
- Editor without delete.
- Deleter without edit.
- PBAC/module/tab-only actor.
- Owner, assignee, watcher, or participant without Room action.
- Missing-prerequisite actor.
- Inactive user and inactive staff row.
- Wrong project and wrong construction site.
- Empty Room.
- Active System Admin override.

Test every command for positive, denied, cross-scope, concurrency, and rollback
behavior. Verify that a task with a historical completion request cannot be
deleted and that the request row remains unchanged.

### 11.3 System-source regression tests

Verify that authoritative progress updates still succeed from:

- Weekly/daily progress commands.
- Daily Log approved/summarized volume paths.
- Quantity acceptance paths.
- Parent rollups.

Verify those routines cannot be invoked broadly by an authenticated browser
and cannot modify a different scope.

### 11.4 Release verification

Run:

- Focused Vitest contracts.
- Full relevant Vitest suite.
- TypeScript/lint checks configured by the repository.
- Production build.
- SQL smoke suite against Supabase Cloud using the existing `.env`.
- Room binding, source, policy, function-definition, and grant snapshots.
- Supabase security/performance advisors relevant to changed objects.

Do not use Supabase local or Docker.

## 12. Rollout and Rollback

### 12.1 Rollout

1. Snapshot Cloud policies, grants, bindings, Room sources, task modes, and
   completion-request counts.
2. Run the migration and backfill in a Cloud transaction and roll it back.
3. Review ambiguous/unmapped backfill rows.
4. Apply the migration to Supabase Cloud.
5. Deploy the frontend and service changes in the same release window.
6. Run the Cloud smoke suite and business acceptance matrix.
7. Keep bindings at `pilot` until acceptance is signed off.

### 12.2 Rollback

Rollback may restore the previous policies, execute grants, frontend bundle,
and per-action PBAC fallback from snapshots. It must not:

- Delete Room membership or audit rows created during the cutover.
- Delete or rewrite historical completion requests.
- Reverse the frozen current progress values.
- Promote obsolete completion actions into the three-action Room.

If frontend and database cannot be rolled back atomically, fail closed and show
a maintenance/retry state rather than restoring permissive direct writes.

## 13. Acceptance Criteria

The cutover is complete when:

1. The Room editor shows only Xem, Sửa, and Xóa for Tiến độ.
2. `gantt.view`, `gantt.edit`, and `gantt.delete` are authoritative in the exact
   project/site scope with PBAC fallback disabled.
3. Every Tiến độ write uses an authorized transactional RPC.
4. Direct authenticated schedule-table writes are denied.
5. Read access is scoped by `gantt.view`; cross-module consumers use minimal
   authorized projections.
6. Completion-request and gate workflow UI/logic are absent from Tiến độ.
7. Historical completion requests and gate metadata remain stored, are not
   changed by the cutover, and are unavailable to authenticated product clients.
8. Legacy completion-driven task progress is preserved and becomes manually
   editable through `gantt.edit`.
9. Tasks with completion-request history cannot be deleted.
10. Weekly progress, Daily Log, quantity acceptance, and approved system
    derivations continue to update task progress through narrow trusted paths.
11. Room-only allow and PBAC/module/owner/assignee-only deny cases pass on
    Supabase Cloud.
12. Focused tests, build, SQL smoke, audit snapshots, and relevant advisors
    pass without unresolved high-severity findings.

## 14. Non-Goals

- Deleting or redesigning the historical completion-request schema.
- Building a new completion approval workflow outside Tiến độ.
- Changing Chốt tiến độ, Daily Log, or quantity-acceptance business rules.
- Refactoring unrelated Project Rooms.
- Giving dashboard or AI consumers unrestricted access to full schedule rows.
- Using Supabase local or Docker.
