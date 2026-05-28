---
name: khotienthinh-session-handoff-2026-05-28
description: Use when continuing work in /Users/admin/khotienthinh on the VIOO/FastCons ERP project after the 2026-05-28 session. Contains current branch state, recent implemented tasks, in-progress work, workflow governance rules, Supabase caveats, project material/PO/MR/Daily Log/reporting rules, and collaboration conventions with anh.
license: private
---

# Khotienthinh Session Handoff - 2026-05-28

Read this before making code changes in `/Users/admin/khotienthinh`.

The user is Vietnamese and expects direct `anh/em` communication. Keep responses pragmatic, concrete, and implementation-focused. Read the code first, do not guess from memory, and never break a flow that already works.

## Must-Read Rule Files

Before changing workflow, approval, return/reject, delete, rollback, inventory, payment, cost, or any real-world side-effect flow, read:

- `.agent/workflows/fastcons-workflow-governance-skill-2026-05-26.md`
- `.agent/workflows/session-skill-2026-05-22.md`

Core rule from anh:

- All functional actions must open a confirm dialog.
- All business actions must be traceable in audit/system history.
- Workflow is step-owned: only the actor at the current step can act.
- Admin can override workflow ownership, but Admin cannot override physical/financial reality.
- If stock, cost, payment, acceptance, receipt, issue, or other downstream real-world effects already happened, rollback/delete must check whether that reality can be safely reversed.

## Current Git State

At the time this file was created:

- Current branch: `refactor/module-du-an-v1`
- Upstream branch: `origin/refactor/module-du-an-v1`
- Recent local HEAD:
  - `ae91f13 Fix giao diện, hêm  tính nang bao cao ngay, tuan ,thang nhat ky cong truong`
  - `4d1cf9c Phân quyền sâu tại module Dự án` on `origin/refactor/module-du-an-v1`

Current worktree has changes. Do not assume it is clean.

Files currently showing modified/added included:

- `App.tsx`
- `components/project/DailyLogSummaryReport.tsx`
- `context/AppContext.tsx`
- `context/ChatContext.tsx`
- `context/RequestContext.tsx`
- `context/WorkflowContext.tsx`
- `lib/dailyLogSummaryService.ts`
- `pages/Login.tsx`
- `pages/MyProfile.tsx`
- `pages/ProjectDashboard.tsx`
- `pages/project/DailyLogTab.tsx`
- `pages/project/GanttTab.tsx`
- `pages/project/MaterialTab.tsx`
- `pages/project/ReportTab.tsx`
- `pages/project/SupplyChainTab.tsx`
- `supabase/migrations/20260527085030_fix_project_tasks_pbac_rls.sql`
- `supabase/migrations/20260527162000_enable_realtime_notifications.sql`

Start any new session with:

```bash
git status --short --branch
git log --oneline --decorate -10
git diff --stat
```

Before pushing:

```bash
git ls-files .env
git grep -n 'sbp_' HEAD
```

Both should return no tracked secret/token results before `git push`.

## Collaboration Rules

- Address the user as `anh`; refer to self as `em`.
- If anh asks to analyze or propose only, do not edit code.
- If anh asks to implement, execute end-to-end: inspect, edit, verify, report.
- Use `rg` / `rg --files` first for search.
- Use `apply_patch` for manual edits.
- Do not use Python for simple file read/write.
- Worktree may be dirty. Never revert unrelated changes.
- Do not commit, push, merge, or apply migrations unless anh asks.
- For UI/TypeScript changes, run:

```bash
npm run lint
npm run build
```

Build warning about chunks larger than 500 kB is an existing Vite warning unless it becomes a failing error.

## Supabase Rules

Use the Supabase skill for any Supabase work.

Current convention:

- No reliable local Supabase DB baseline.
- Many migrations were historically applied cloud-only.
- Be careful with `supabase db push --linked`; it may fail or show local-only migrations because cloud migration history was not fully aligned.
- Do not run destructive DB commands.
- Do not run `supabase db reset`.
- Do not claim a migration is applied until verified against cloud/schema.

Known recent Supabase work:

- `20260527085030_fix_project_tasks_pbac_rls.sql`
  - Fixes `project_tasks` RLS for PBAC edit/delete flows.
  - Was applied directly through linked Supabase query after `db push` was blocked by migration-history mismatch.
  - Verified for user `248cd764-f22c-4b1b-ad10-e059692abc35`: authenticated insert/update passed in a rollback transaction.
- `20260527162000_enable_realtime_notifications.sql`
  - Present in worktree. Verify apply status before assuming it is live.

## Implemented / Recent Tasks

### 1. Workflow Governance Rule

Created and adopted:

- `.agent/workflows/fastcons-workflow-governance-skill-2026-05-26.md`

It defines the standard lifecycle:

- `DRAFT`
- `SUBMITTED/PENDING`
- returned-to-draft with visible `Bị trả lại`
- `REJECTED`
- approved/next step
- `IN_PROGRESS/IN_TRANSIT`
- `COMPLETED/CLOSED`

Non-negotiable rules:

- Every action writes audit/system history.
- Deleted documents still leave tombstone/history.
- Step owner acts within their step only.
- Admin cannot rollback used stock/money/actual downstream usage unless reversal is physically/financially possible.
- UI confirm is mandatory for every functional mutation.

### 2. Project Material Request / PO / Fulfillment Flow

Implemented or planned across recent sessions:

- MR/YCVT completion is based on actual received quantity, not just issued/ordered quantity.
- `material_request_fulfillment_batches/lines` is the MR fulfillment ledger.
- Internal stock issue creates a fulfillment batch/issue document.
- Site receives actual quantity; partial receipt keeps MR in transit/partial until cumulative received reaches request quantity.
- PO linked to MR should sync actual received quantity back into MR ledger through request-line links.
- Returned/cancelled/draft batches do not count into received totals.
- PO/MR actions should be performed from opened detail, not quick status buttons on summary cards.
- QR is used for supplier receipt and internal stock issue receipt.
- Added/kept print QR and PDF-style print flow for stock issue/PO documents.

Important behavior example:

- Site requests 100 kg.
- Warehouse issues 60 kg and site receives 60 kg.
- PO buys 40 kg.
- If supplier delivers 30 kg, MR received is 90/100 and remains incomplete.
- Only when actual received reaches 100/100 does MR become complete.

### 3. PO Return / Delete / Rollback Rules

Recent requirements from anh:

- PO should support return/returned state, including after closed when valid.
- Admin may return/rollback only if enough stock remains to reduce/return.
- Never allow negative stock to make rollback pass.
- Deleting cancelled/returned PO should be allowed only when no active warehouse receipt/issue/use exists.
- Error messages must explain the blocking real-world reason.

Rule:

- Status alone is not enough. Always check downstream warehouse transactions, fulfillment batches, PO links, receipts, and current stock.

### 4. Material Request Draft / Submit / Return / Delete Flow

Agreed behavior:

- Creating an MR/YCVT should create a `DRAFT`.
- User fills material request first.
- Only after reviewing the draft should user choose recipient and submit for approval.
- Submitted request becomes pending/waiting for approval.
- Approver can approve, return for supplement, or reject.
- Return uses option A:
  - status returns to `DRAFT`
  - visible label/log says `Bị trả lại`
  - reason is preserved
- Delete:
  - user can delete clean draft.
  - creator can delete rejected/returned cleanup if no downstream operation exists.
  - Admin can clean pending/rejected garbage if no downstream operation exists.
  - All delete/cleanup must preserve audit history.

### 5. Deep Permission Split In `Dự án > Vật tư`

Implemented plan:

- Split material sub-tab management from broad `canManageTab`.
- Sub-tabs:
  - Summary
  - BOQ
  - Request
  - PO
  - Waste
  - Dashboard
- User can manage material requests while only viewing PO.
- Old full material-tab admin permission remains backward-compatible.
- `MaterialTab` now receives material sub-permissions.
- `SupplyChainTab` receives PO-specific manage permission.

Expected roles:

- Site user:
  - can create/request material
  - can view PO
  - cannot create/edit/delete/status-change PO
- QS:
  - can manage BOQ
  - can view PO
- Procurement/material team:
  - can manage request and PO

### 6. Project Module Performance Optimization

Recent performance direction:

- Reduce heavy initial load in Project module.
- Lazy-load or warm up expensive contexts after first paint where safe.
- Avoid loading all heavy tabs at once.
- Existing touched files include:
  - `App.tsx`
  - `context/AppContext.tsx`
  - `context/ChatContext.tsx`
  - `context/RequestContext.tsx`
  - `context/WorkflowContext.tsx`
  - `pages/ProjectDashboard.tsx`
  - `pages/project/MaterialTab.tsx`
  - `pages/project/SupplyChainTab.tsx`

Verify with `npm run lint` and `npm run build` after any further edits.

### 7. Project Tasks RLS / PBAC Fix

Issue:

- User `248cd764-f22c-4b1b-ad10-e059692abc35` had admin permission for sub-tab Nhật ký but saving progress failed:
  - `new row violates row-level security policy for table "project_tasks"`

Fix:

- Added migration file:
  - `supabase/migrations/20260527085030_fix_project_tasks_pbac_rls.sql`
- Policy uses PBAC:
  - Admin can write.
  - User with `app_private.project_user_has_permission(project_id::text, construction_site_id::text, 'edit')` can insert/update.
  - Delete requires Admin or PBAC delete.

Verification already performed:

- Direct cloud query applied SQL.
- Policies inspected via `pg_policies`.
- Simulated authenticated user insert/update passed in rollback transaction.

### 8. Daily Log Summary Report

Implemented:

- `lib/dailyLogSummaryService.ts`
  - Adds `DailyLogSummaryMode = 'day' | 'week' | 'month'`
  - Adds summary filters and period summary structures.
  - Aggregates verified/filtered daily logs by day, week, month.
  - Week uses Monday-Sunday.
  - Official KPI defaults to `verified`.
  - Draft/submitted/rejected remain visible as data-quality warnings.
  - Worker count prioritizes `laborDetails`; fallback to `workerCount`.
  - Aggregates:
    - workers
    - labor by type/group/catalog
    - machines by machine/catalog/group
    - weather
    - issues
    - delay days by category
    - materials
    - volumes
    - photo/GPS compliance

- `components/project/DailyLogSummaryReport.tsx`
  - Adds UI report in `Dự án > Báo cáo`.
  - Filters:
    - from/to date
    - day/week/month
    - status scope
    - creator
  - KPI cards:
    - verified logs
    - missing verified days
    - average/peak workforce
    - total workforce
    - machine shifts
    - rain/storm days
    - delay days
    - photo/GPS compliance
  - Charts:
    - workforce trend
    - weather distribution
    - labor breakdown
    - machine shifts
    - delay causes
  - Period table and detail drilldown.
  - Links back to source Daily Log records.
  - `Xuất PDF` uses browser print/save-as-PDF flow.

- `pages/project/ReportTab.tsx`
  - Adds subview toggle:
    - `Tổng hợp dự án`
    - `Nhật ký công trường`
  - Supports query:
    - `?tab=report&reportView=dailylog`

- `pages/project/DailyLogTab.tsx`
  - Adds quick link `Xem báo cáo nhật ký` to open the report subview.

Verification:

```bash
npm run lint
npm run build
```

Both passed after this implementation.

### 9. Baseline / So Sánh BL Explanation

Explained to anh:

- `Chốt baseline` captures the approved schedule snapshot at a point in time.
- `So sánh BL` compares actual/current schedule against baseline.
- Used to identify slip, early/late tasks, and changes against the approved plan.

No major implementation was requested at that step.

### 10. Schedule Conflict Warning Task

Anh described a requirement:

- When adjusting task start/end dates, the system should detect overlapping/affected tasks.
- On confirm, show a warning listing affected tasks, planned start, planned end, and conflict reason.
- User can still confirm and proceed after seeing the conflict.

Status:

- Task is intentionally paused.
- Do not implement until anh asks to resume.

Recommended future implementation:

- Add conflict detection helper in schedule rules/service.
- Compare proposed task date range against same-level/same-dependency/same-resource relevant tasks.
- Show confirm dialog with affected task list.
- If user confirms, save normally and audit the override.

## Core Business Rules

### General Workflow

Most modules follow this pattern:

1. User creates draft.
2. User submits to a selected handler.
3. Handler approves, returns for supplement, or rejects.
4. Returned documents go back to draft with reason and visible returned label.
5. Approved documents move to the next operational step.
6. Complete/close only after downstream reality is verified.
7. Delete/rollback requires downstream checks and audit trace.

### Confirm Dialog

Every functional action must open a confirm dialog:

- submit
- approve
- return
- reject
- cancel
- delete
- close
- complete
- receive
- issue
- return goods
- payment
- rollback
- admin override

Use app helpers:

- `useConfirm()`
- `useReasonConfirm()`
- `useToast()`

Do not use:

- `window.confirm`
- `window.prompt`

### Audit / History

All actions must write traceable history.

Minimum fields:

- module/entity type
- entity id/code
- action
- old status
- new status
- actor id/name
- target handler id/name when relevant
- reason/note
- timestamp
- downstream refs/metadata

Hard delete must still leave tombstone/system activity. Deleted documents must remain traceable.

### Admin Rule

Admin may:

- clean stuck pending/rejected records
- override workflow ownership
- repair obvious state issues

Admin may not:

- make stock negative
- delete used inventory history
- erase payment/cost reality
- bypass downstream ledgers just because parent status allows it

### Inventory / Warehouse

- Any stock decrease must check current stock.
- Never allow negative stock.
- Prefer compensating transactions over deleting history.
- Internal site receipt should be driven by QR stock issue/fulfillment batch.
- Supplier receipt by QR is already okay; manual confirmation remains supported.

### PO / MR

- Parent status must derive from line-level actuals where quantities matter.
- MR completion is based on actual site-received quantity.
- PO ordered quantity does not complete MR.
- Warehouse issued quantity does not complete MR until site confirms actual receipt.
- PO receipt linked to MR must update MR fulfillment ledger.
- Returned/cancelled/draft records do not count into completion.
- Operational action buttons should live inside opened document detail, not on summary cards.

### Daily Log

- Daily Log is the source of actual execution progress after verification.
- Statuses:
  - `draft`
  - `submitted`
  - `verified`
  - `rejected`
- Creator can edit draft/rejected.
- Submitted belongs to selected verifier.
- Verified is locked except allowed admin correction.
- Verified volume rows drive actual progress.
- Do not use unverified logs for official progress/reporting unless explicitly requested.
- In Daily Log FastCons material tab, site stock should come from the construction site's site warehouse where possible.

### BOQ / Baseline

- Contract BOQ and construction BOQ are separate.
- Reconciliation uses mapping groups, not direct child structure.
- Only reviewed/locked reconciliation groups feed official reports/payment suggestions.
- Baseline is the approved schedule snapshot; comparisons should show variance against it.

### Permissions

Permission guard layers:

1. UI visibility/disabled state.
2. Service-level guard.
3. Supabase RLS/RPC/database guard.

UI-only permission checks are incomplete.

For `Dự án > Vật tư`, use deep sub-tab permissions:

- material summary
- material BOQ
- material request
- material PO
- material waste
- material dashboard

Keep backward compatibility for old full material tab admin permission.

## UI Rules

- Build the usable operational screen, not a landing page.
- ERP screens should be dense, scan-friendly, and restrained.
- Use existing design conventions.
- Use `lucide-react` icons where appropriate.
- Do not add decorative gradients/orbs that distract from work.
- Avoid text overflow in buttons/cards.
- For dangerous actions, make consequences clear in confirm dialogs.
- For business selection, prefer searchable picker/typeahead where available.

## Verification Checklist Before Returning Work

For UI/TypeScript:

```bash
npm run lint
npm run build
```

For Supabase/RLS:

- inspect relevant policies/functions
- test a real or simulated role where possible
- verify cloud state if migration history is uncertain

For workflow changes:

- allowed actor can act
- wrong actor cannot act
- confirm dialog appears
- audit/history is written
- delete blocks active downstream records
- admin override still respects real stock/money

## Recommended First Steps In A New Chat

1. Read this file.
2. Read `.agent/workflows/fastcons-workflow-governance-skill-2026-05-26.md` before workflow edits.
3. Run:

```bash
git status --short --branch
git diff --stat
```

4. Ask anh whether to:

- continue implementation,
- commit current changes,
- push branch,
- merge to main,
- or resume the paused schedule conflict warning task.

Do not assume current worktree changes are yours or safe to revert.
