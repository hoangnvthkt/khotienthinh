# Weekly Progress Three-Action Room Design

## 1. Purpose

Simplify the Project permission Room `weekly_progress` so it matches the
business process that actually exists in the Chốt tiến độ ngày/tuần tab.

The tab does not have a submit, verify, or approval workflow. Users enter
progress data directly and an authorized user closes the selected period.
The Room therefore exposes exactly three business actions:

- `view`: view progress data and period status.
- `edit`: enter and update data while the selected period is open.
- `confirm`: close or reopen the selected period.

The contextual Vietnamese labels are **Xem**, **Sửa/Nhập liệu**, and
**Chốt/Mở chốt**. The generic label **Xác nhận** must not be used for
`weekly_progress.confirm`.

## 2. Decisions

### 2.1 No approval workflow

Remove `submit`, `verify`, and `approve` from the `weekly_progress` Room.
They do not correspond to a current UI state, assignee, document transition,
or backend invariant.

Set `required_actions` for the Room to an empty array. Chốt tiến độ is an actor
capability, not a recipient workflow, so saving Room membership must not require
an active workflow recipient.

### 2.2 Reuse `confirm` for close/reopen

Keep the shared Room action code `confirm` and give it the contextual meaning
**Chốt/Mở chốt** in this Room. This avoids expanding the global Room action
vocabulary while preserving the domain meaning already approved in the Project
Room design.

The PBAC compatibility mapping is:

| Room action | Project PBAC compatibility codes |
| --- | --- |
| `view` | `project.weekly_progress.view` |
| `edit` | `project.weekly_progress.create`, `project.weekly_progress.edit_all` |
| `confirm` | `project.weekly_progress.lock` |

`project.weekly_progress.manage` remains a module administration capability and
is not shown as a fourth Room action. The obsolete weekly-progress PBAC actions
`submit`, `verify`, and `approve` must not be used by new consumers. Existing
grants are audited before they are retired; they are never inferred as
`confirm` grants.

### 2.3 Prerequisites

- `edit` requires `view`.
- `confirm` requires `view`.
- `confirm` does not require `edit`.

This permits data-entry staff to save open-period data and a separate closing
authority to close or reopen a period without granting broad edit access.
System Admin retains the existing operational actor override, but is not added
automatically as a Room member or recipient.

## 3. Period Model

### 3.1 Independent period types

Locks are scoped by:

- Project/construction-site scope.
- Period type: `daily` or `weekly`.
- Period start:
  - `daily`: the selected progress date.
  - `weekly`: the Monday that starts the selected ISO week.

A daily lock applies only to that date. A weekly lock applies only to the
weekly aggregate. The two lock types do not implicitly lock each other.

If a week is locked while one of its daily periods remains open, authorized
data-entry users may continue editing that open daily period. The locked weekly
aggregate remains frozen. It is recalculated only after the weekly period is
reopened and explicitly saved or closed again.

### 3.2 Stored state

Add a scoped period-state table, conceptually
`project_progress_period_states`, with one row per scope, period type, and
period start. Required fields:

- `id`
- `scope_key`
- `project_id`
- `construction_site_id`
- `period_type` (`daily` or `weekly`)
- `period_start`
- `is_locked`
- `locked_by`
- `locked_at`
- `unlocked_by`
- `unlocked_at`
- `unlock_reason`
- `created_at`
- `updated_at`

Enforce a unique key on `(scope_key, period_type, period_start)` and validate
that the scope columns agree with the canonical scope key. Rows without an
explicit state are treated as open for backward compatibility.

The state row provides the latest status. Every close and reopen is also
written to the existing immutable permission/business audit stream with actor,
scope, period type, period start, event, timestamp, and reopen reason. Audit
history must not depend on mutable fields in the state row.

## 4. Authorization and Data Flow

### 4.1 Reads

An active actor with effective `weekly_progress.view` may read:

- Daily progress rows within the authorized project/site scope.
- Weekly progress rows within the authorized project/site scope.
- Weekly snapshots within the authorized project/site scope.
- Period state for the same scope.

Cross-project and cross-site reads are denied. System Admin follows the
existing actor override.

### 4.2 Saving open periods

Replace direct client table mutations with backend RPCs for daily and weekly
progress. Each save RPC must, in one transaction:

1. Resolve the current app actor.
2. Validate the project/site scope and every task in the payload.
3. Require effective Room action `weekly_progress.edit`.
4. Lock and inspect the matching period-state row to prevent a concurrent
   close/save race.
5. Reject the operation if the selected daily or weekly period is locked.
6. Upsert progress rows.
7. Update derived task progress and the appropriate open-period snapshot.
8. Record the actor and timestamps.

Daily saves may update an open weekly aggregate. They must not mutate a locked
weekly aggregate or its frozen snapshot.

### 4.3 Closing a period

Closing is performed through a dedicated RPC and requires effective Room
action `weekly_progress.confirm`.

The close RPC must accept the current draft payload when the caller also has
`edit`. It saves the payload and locks the period atomically, preventing a
successful save followed by a failed close. A caller with `confirm` but without
`edit` can close the already persisted data but cannot alter it.

The close RPC:

1. Validates actor, scope, action, period type, and period start.
2. Rejects an already locked period as a deterministic no-op/error response.
3. Persists an authorized draft payload when supplied.
4. Freezes the daily data or weekly aggregate/snapshot for the selected period.
5. Sets `is_locked`, `locked_by`, and `locked_at`.
6. Writes a `weekly_progress_period_locked` audit event.

### 4.4 Reopening a period

Reopening requires effective Room action `weekly_progress.confirm` and a
non-empty reason. It does not grant edit permission.

The reopen RPC:

1. Validates actor, scope, action, and the locked period.
2. Rejects a blank or whitespace-only reason.
3. Sets the period to open and records actor, timestamp, and reason.
4. Writes a `weekly_progress_period_unlocked` audit event.

After reopen, only an actor with `edit` may modify data. An actor with
`confirm` may close the unchanged period again.

### 4.5 RLS and grants

Remove direct `INSERT`, `UPDATE`, and `DELETE` access for authenticated clients
on:

- `project_daily_task_progress`
- `project_weekly_task_progress`
- `weekly_progress_snapshots`
- `project_progress_period_states`

Expose scoped reads through restrictive RLS or a read RPC. Expose all writes
only through the authorized backend RPCs. Privileged functions remain in
`app_private`; public wrappers receive only the minimum `authenticated`
execution grants.

The backend remains authoritative even if the UI is bypassed.

## 5. User Interface

### 5.1 Room configuration

The Room drawer displays only:

- Xem
- Sửa/Nhập liệu
- Chốt/Mở chốt

Bulk actions use the same contextual labels. Assigning Sửa or Chốt also assigns
Xem through prerequisites. The Room card does not report a missing approver and
saving an empty Room is permitted.

Obsolete `submit`, `verify`, and `approve` grants are removed from
`weekly_progress` Room membership during migration. No obsolete action is
automatically converted to `confirm`.

### 5.2 Progress workspace

For the selected daily or weekly period:

- A viewer sees data and the Open/Locked state.
- An editor sees editable fields and **Lưu thay đổi** only while open.
- A closer sees **Chốt kỳ** while open.
- A closer sees **Mở chốt** while locked.
- A locked period renders all progress inputs read-only for every actor.
- Reopen opens a confirmation dialog with a required reason field.

If the same actor has both `edit` and `confirm`, **Chốt kỳ** saves the displayed
draft and closes the period atomically.

Use explicit Vietnamese errors:

- `Kỳ tiến độ đã được chốt. Hãy mở chốt trước khi sửa.`
- `Bạn không có quyền Sửa/Nhập liệu tiến độ.`
- `Bạn không có quyền Chốt/Mở chốt kỳ tiến độ.`
- `Vui lòng nhập lý do mở chốt.`

Do not expose raw Postgres constraint or English Room-recipient messages.

## 6. Migration and Compatibility

1. Create the period-state schema, indexes, audit support, and RPCs.
2. Add Room/PBAC bindings for `view`, `edit`, and `confirm` with prerequisite
   metadata.
3. Change the `weekly_progress` Room whitelist to those three actions and set
   `required_actions` to empty in both TypeScript and database registry.
4. Preserve only existing Room grants for `view`, `edit`, and `confirm`; remove
   obsolete weekly-progress Room action rows.
5. Do not infer old `approve`, `verify`, or `submit` grants as close authority.
6. Audit existing PBAC grants before marking obsolete action definitions
   inactive and update permission templates that still grant them.
7. Backfill no lock rows: all historical periods start open until explicitly
   closed after rollout.
8. Switch the UI/service to RPC reads and writes.
9. Remove permissive mutation policies and direct table grants only after the
   RPC path passes allow/deny smoke tests.
10. Promote the three Room bindings from `audit_only` to `pilot`, then to
    `enforced` only after production evidence confirms the frontend, RPC, RLS,
    scope isolation, and audit behavior.

## 7. Concurrency and Failure Handling

- Save, close, and reopen serialize on the period-state row.
- A close racing with a save has one deterministic winner; the loser receives
  a locked-period conflict and no partial writes.
- A repeated close or reopen does not duplicate audit events.
- Any task/scope mismatch rejects the entire payload.
- Save-and-close is atomic across progress data, derived weekly/snapshot data,
  period state, and audit event.
- Client refreshes status and data after any conflict or successful transition.

## 8. Testing

### 8.1 Unit and contract tests

- The Room exposes exactly `view`, `edit`, and `confirm`.
- The contextual label for `confirm` is Chốt/Mở chốt.
- `edit` and `confirm` include `view` as a prerequisite.
- The progress UI no longer checks only `canManageTab` for mutations.
- The service no longer performs direct client upserts to protected tables.

### 8.2 Database smoke tests

- `view` can read only its authorized scope and cannot mutate.
- `edit` can save an open daily or weekly period.
- `edit` cannot save a locked period.
- `confirm` can close and reopen but cannot edit without `edit`.
- Reopen requires a reason and records it.
- A daily lock affects only its date.
- A weekly lock affects only its weekly aggregate.
- Daily edits under a locked week do not mutate the frozen weekly aggregate.
- Cross-project and cross-site reads/writes are denied.
- Direct Data API mutations are denied.
- System Admin actor override works without creating a Room recipient.
- Concurrent save/close cannot leave partial or post-lock data changes.

### 8.3 Regression tests

- Existing progress history and charts remain readable.
- Open historical periods remain editable according to Room action.
- Task progress, actual dates, weekly rollups, and value snapshots retain their
  current calculations for open periods.
- Other Room contextual uses of `confirm` are unchanged.

## 9. Acceptance Criteria

- Weekly Progress Room shows only Xem, Sửa/Nhập liệu, Chốt/Mở chốt.
- Empty Room configuration saves without a recipient error.
- No submit, verify, or approve workflow appears in the progress UI or backend.
- An editor can save only open periods.
- A closer can close or reopen the selected daily/weekly period.
- Reopening always records a reason and audit identity.
- Daily and weekly locks are independent.
- Locked data cannot be changed through the UI, Supabase client, or direct Data
  API call.
- Authorization is isolated by project and construction site.
- All allow/deny and concurrency tests pass before enforcement is enabled.

## 10. Out of Scope

- Multi-step submit/review/approval workflows.
- Assigning a workflow recipient or approver.
- Automatically converting legacy approval grants into close authority.
- Locking a daily period automatically when its week is closed.
- Locking a weekly period automatically when one of its days is closed.
- Redesigning progress calculations, WBS weighting, or value-progress formulas.
