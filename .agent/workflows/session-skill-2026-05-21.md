---
name: khotienthinh-session-handoff-2026-05-21
description: Use when working in /Users/admin/khotienthinh with anh on the VIOO/FastCons ERP project. Contains session history, Supabase cloud-only migration rules, Excel import/export conventions, anti-double-submit rules, approval permissions, Daily Log/FastCons progress logic, notification deep links, and implementation preferences.
license: private
---

# Khotienthinh Session Skill - 2026-05-21

Read this before making code changes in `/Users/admin/khotienthinh`.

The user is Vietnamese and expects direct anh/em communication. Be pragmatic, read the code first, make surgical changes, and verify with `npm run lint` / `npm run build` whenever code changes affect TypeScript or UI behavior.

## Core Working Rules

- Do not use a local database. All Supabase schema changes are cloud-only.
- Do not run `supabase db push`, `supabase db reset`, or local migration flows.
- Use `rg` / `rg --files` first for search.
- Use `apply_patch` for manual file edits.
- Worktree may be dirty from prior sessions. Never revert unrelated changes.
- Keep UI changes scoped to the requested module. Avoid decorative animations and heavy visual effects.
- Prefer searchable combobox/typeahead over long select lists for business data.
- After implementation, run:
  - `npm run lint`
  - `npm run build`
- If running a dev server, use:
  - `npm run dev -- --host 127.0.0.1`
  - If sandbox blocks listening, request escalation.

## Supabase Cloud-Only Migration Workflow

Always use the Supabase skill when the task touches Supabase.

Use this workflow:

1. Create migration with the CLI:
   ```bash
   npx supabase migration new <descriptive_name>
   ```
2. Edit the generated SQL file in `supabase/migrations/`.
3. Apply directly to the linked cloud project:
   ```bash
   SUPABASE_ACCESS_TOKEN="$SUPABASE_ACCESS_TOKEN" npx supabase db query --linked -f supabase/migrations/<version>_<name>.sql
   ```
4. Verify cloud state with SQL queries through `supabase db query --linked -f <verify.sql>` or equivalent. Prefer checking:
   - new table/column existence
   - RLS enabled
   - policies in `pg_policies`
   - grants do not expose `anon`/`public`
   - RPC behavior for allowed and blocked users when relevant
5. Mark migration as applied in migration history:
   ```bash
   SUPABASE_ACCESS_TOKEN="$SUPABASE_ACCESS_TOKEN" npx supabase migration repair <version> --linked --status applied
   ```
6. Confirm:
   ```bash
   SUPABASE_ACCESS_TOKEN="$SUPABASE_ACCESS_TOKEN" npx supabase migration list --linked
   ```

Do not save tokens into files. If the user provides a Supabase access token, use it only as an environment variable in commands and do not print it in final answers.

Supabase CLI sometimes modifies `supabase/.temp/cli-latest`. Check it after CLI work and do not leave unrelated CLI noise in the diff.

Important Supabase security reminders:

- UPDATE under RLS requires a SELECT policy too.
- Enable RLS on public tables.
- Do not grant `anon`/`public` casually.
- Prefer RPC for sensitive state transitions.
- Views can bypass RLS unless `security_invoker` is used or access is restricted.
- Do not expose `service_role` in frontend code.

## Current Migration/DB Context

Relevant migrations created or touched in this work stream:

- `20260519040705_add_project_soft_hide.sql`: project soft-hide migration requested by user; apply cloud-only.
- `20260519144202_fix_workflow_fast_rpc_ambiguous_columns.sql`: workflow RPC hardening/fix.
- `20260519162803_project_work_boq_sync.sql`: project work BOQ sync tables/columns.
- `20260520063142_task_completion_progress.sql`: task completion request groundwork; now legacy/secondary.
- `20260520093252_daily_log_progress_catalog_sources.sql`: daily log progress source and catalog fields.
- `20260520094452_harden_daily_log_catalog_grants.sql`: harden daily log/catalog grants.
- `20260520102712_daily_log_requested_verifier.sql`: requested verifier columns.
- `20260520163019_harden_daily_log_status_deeplinks.sql`: Daily Log RLS/RPC and notification deep links.
- `20260520171906_daily_log_volume_completion_fields.sql`: Daily Log volume attachments and nullable construction site for project-scope logs.

Before assuming a migration is applied, verify cloud with `migration list --linked` and schema queries.

## Permission And Approval Rules

The project follows "ai làm việc ấy":

- Admin can do everything.
- Creator/owner can edit content only while the document is `draft` or `rejected`.
- Once submitted, creator cannot edit until it is returned.
- Reviewer/verifier can only verify/return, not edit content.
- Returned document can be edited by creator and resubmitted.
- Apply this first to Daily Log; reuse the pattern for other approval modules.

For Daily Log:

- `draft`: creator can edit/delete/send.
- `submitted`: assigned verifier with `verify` permission can verify or return.
- `verified`: locked except admin.
- `rejected`: creator can edit and resubmit.
- Status change should use `dailyLogService.updateStatus` / RPC, not full `upsert`, to avoid rewriting details and hitting RLS.
- Store and use:
  - `created_by_id`
  - `submitted_by_id`
  - `submitted_to_user_id`
  - `requested_verifier_id`
  - `requested_verifier_name`
  - `verified_by_id`
  - `rejected_by_id`
  - timestamps and rejection reason where available.

When adding submit/verify buttons:

- Disable while busy.
- Guard with a synchronous ref or per-record busy set.
- Re-check permission before the mutation.
- Avoid calling the same RPC twice on rapid clicks.

Anti-double-submit pattern:

```ts
const savingRef = useRef(false);

const handleSave = async () => {
  if (savingRef.current) return;
  savingRef.current = true;
  setSaving(true);
  try {
    // save once
  } finally {
    savingRef.current = false;
    setSaving(false);
  }
};
```

For per-row status actions, keep `Set<string>` of busy IDs and refuse a second action for the same ID until the first finishes.

## Notification Rules

In-app notification is the source of truth. Browser notification may mirror it.

When creating notifications:

- Deduplicate recipients.
- Do not notify the actor unless explicitly required.
- Include enough metadata for deep link:
  - `sourceType`
  - `sourceId`
  - `link`
  - `metadata` with entity IDs.
- Click should mark read, close panel, navigate to content.

Route conventions:

- Daily Log:
  ```text
  /da?projectId=...&siteId=...&tab=dailylog&dailyLogId=...
  ```
- Workflow:
  ```text
  /wf?instanceId=...
  ```
- RQ:
  ```text
  /rq?requestId=...
  ```

Fallback to `notification.link` when old notifications lack metadata.

Browser notification `onclick` should use the same resolver as `NotificationCenter`.

## Workflow Module Notes

Earlier issue: admin assigned correctly but approve/reject/revision failed with "Thao tác quy trình thất bại". Root cause was in Workflow/RPC path, not UI route confusion. Fixes focused on `process_workflow_instance_fast` and DB permission checks.

Workflow security target:

- DB must check current node assignee user, assignee role, template manager, or module admin before approve/reject/revision.
- Kanban "Giao cho" must persist assignee override through RPC/service, not only mutate local node.
- Notify:
  - assigned user or users by role
  - next assignee on step transition
  - creator on approved/rejected/revision
  - watchers when added

## Project Schedule And Progress

The agreed source of real progress is now **verified Daily Log / Nhật ký thi công đã xác nhận**.

Rules:

- `project_tasks.provisional_quantity` is the denominator for daily-log progress.
- Daily Log FastCons volume rows must link to schedule task:
  - `daily_log_volumes.task_id`
  - `daily_log_volumes.task_name`
  - `quantity`
  - `unit`
- Child task progress:
  ```text
  progress = sum(verified daily_log_volumes.quantity for task_id) / provisional_quantity
  ```
- If `provisional_quantity = 0`, do not auto-calculate; show warning/0 until quantity exists.
- Parent task progress:
  - weighted by child `provisional_quantity` when all direct children have quantity > 0
  - fallback equal weighting if any child lacks quantity
- When a Daily Log becomes `verified` or is returned/changed, recalculate affected tasks and parents.
- If a task reaches 100%, set completion/gate-related fields only according to existing schedule rules.

Legacy `project_task_completion_requests` and "Phiếu hoàn thành công việc" exist for compatibility, but the standard v1 flow is no longer based on them. Do not reintroduce the old completion-request UI unless the user explicitly asks.

Milestone rule:

- Milestones should still show start date, end date, and duration.
- Do not force milestone duration to 0.
- On Gantt, draw a duration bar when start/end span days; only draw diamond when start=end or duration=0.

The user prefers the Gantt/header to show day granularity under months, not only months.

## Daily Log / FastCons Notes

Daily Log form should be wide, roughly 80% desktop width and responsive mobile.

FastCons sections:

- `Khối lượng`
- `Vật tư`
- `Nhân công`
- `Máy TC`

Recent important fix:

- Khối lượng previously did not persist because an empty string was sent into UUID `contract_item_id`, and the detail service swallowed the error.
- Sanitize empty ID strings to `null` before insert.
- Detail writes must throw on failure so the UI does not show false success.
- `daily_log_volumes.attachments` exists for evidence.

FastCons `Khối lượng` UI should resemble the "Báo hoàn thành công việc" reference:

- task search from schedule
- `KL tạm tính`
- `Đã xác nhận`
- `Còn lại`
- `Khối lượng hoàn thành`
- `Ghi chú`
- `Bằng chứng`

Daily Log list must support full read-only view:

- Any user who can see the list should be able to open a full detail modal.
- The verifier should review the full phiếu, not a tiny proposal line.
- Full viewer shows description, issues, photos, GPS, volumes, materials, labor, machines, delay tasks.
- If allowed, reviewer actions can be available in the detail modal.

Current relevant files:

- `pages/project/DailyLogTab.tsx`
- `components/project/DailyLogDetailTabs.tsx`
- `lib/dailyLogDetailService.ts`
- `lib/projectScheduleRules.ts`
- `lib/projectService.ts`
- `types.ts`

## Contract Catalog, Labor, Machines

User requirement:

- `HĐ danh mục >> Nhân công >> Thêm mới`: "Nhóm nhân công" comes from `Danh sách HĐ đối tác` where partner classification is contractor/subcontractor when available, but user can type free text for small informal crews.
- Store `partnerId` and `partnerName` if selected from partner; otherwise only `groupName`.
- `Chi tiết thi công (FastCons) >> Nhân công` has two input modes:
  - from `HĐ danh mục >> Nhân công`
  - directly from `HĐ đối tác` for quick crew-level entry
- `Chi tiết thi công (FastCons) >> Máy TC` comes from `HĐ danh mục >> Máy thi công`.
- All selectors must be searchable/typeahead, not long combo-box lists.
- Daily Log `workerCount` should be computed from `laborDetails.count`, not entered independently.

Project organization:

- When adding project organization members, job position should come from `Dữ liệu gốc HRM >> Vị trí công việc`.

## Project BOQ And Excel Import/Export

Business model:

- Contract BOQ in `Hợp đồng > Hợp đồng nhận thầu >> BOQ gốc` is the signed owner BOQ and must remain unchanged.
- Field/project BOQ in `Tổng quan dự án >> Vật tư >> BOQ` is generated/synced from project schedule WBS and used for execution quantities.
- Do not write into `contract_items` from schedule/field BOQ sync/import.

Data model:

- `project_work_boq_items`: execution BOQ work-item tree.
- `material_budget_items.work_boq_item_id`: material rows belong to a field BOQ work item.
- `sync_status`: `synced`, `manual`, `orphaned`.

Sync policy for "Đồng bộ với tiến độ":

- Create/update tree from `project_tasks`.
- New rows take `planned_qty` from `project_tasks.provisional_quantity` and unit from fallback unit.
- Existing rows update only metadata:
  - `wbs_code`
  - `name`
  - `parent_id`
  - `sort_order`
  - `sync_status`
- Do not overwrite manually entered:
  - `unit`
  - `planned_qty`
  - `unit_price`
  - material child rows
  - notes
- Deleted schedule task should not delete BOQ; mark BOQ row `orphaned`.
- Avoid sending DB-generated or DB-computed columns in inserts/updates:
  - `created_at`
  - `updated_at`
  - `total_amount`

Excel import/export:

- Always provide export template and import preview before write.
- Use structured parsing with `xlsx`.
- Validate required columns and show row-level errors.
- For tree data, use WBS and parent WBS/code.
- Schedule import columns should include `Mã WBS`, `Mã cha`, `Tên hạng mục`, dates, unit, `Khối lượng tạm tính`.
- Field BOQ export/import sheets:
  - `Dau_muc`: WBS, Mã cha, Tên đầu mục, ĐVT, KL dự toán, Đơn giá, Ghi chú.
  - `Vat_tu`: WBS đầu mục, Mã vật tư, Tên vật tư, Nhóm, ĐVT, KL dự toán, Đơn giá, Ngưỡng hao hụt, Ghi chú.
- Material matching:
  - Prefer `(work_boq_item_id, material_code)`.
  - Fallback `(work_boq_item_id, item_name, unit)`.

## Notification And Browser Permission UX

Phase 1:

- Use Realtime + `new Notification()` when app is open or tab is backgrounded.
- Ask browser permission from explicit UI, not random first click.

Phase 2:

- Use `web_push_subscriptions`, service worker, VAPID keys, and Supabase Edge Function `send-web-push`.
- Notification insert remains source of truth; edge function sends push to subscriptions for `user_id`.

## UI And Product Preferences

The user disliked bulky filters and unnecessary UI.

General UI preferences:

- Keep surfaces light, compact, and fast.
- Remove unnecessary animations/zoom effects.
- Prefer Apple-like restraint: clean spacing, smooth but minimal transitions, no visual noise.
- For filters, show a simple search bar and one button "Tìm kiếm nâng cao" that expands advanced options.
- Avoid card-within-card layouts.
- Keep buttons stable; prevent text overflow.
- Business forms should prioritize input space and review clarity over decorative panels.

## Route/Module Guard Notes

Sensitive routes should be mapped to module permissions:

- `settings`
- `chat`
- `storage`
- `ai/*`
- `audit-trail`
- `analytics`
- `org-map`
- `custom-dashboard`

Personal routes stay available to all authenticated users:

- `/my-profile`
- `/employee-dashboard`

`usePermission.canManage` should support dynamic routes using `matchPath`, matching `SubModuleGuard`.

## Testing Checklist For This Project

For code changes:

- `npm run lint`
- `npm run build`

For cloud migrations:

- Apply cloud-only with `supabase db query --linked -f`.
- Repair migration status.
- Verify schema and RLS/grants.
- For policies/RPC, test a blocked user scenario where feasible.

Manual scenarios commonly expected by user:

- User without module permission cannot open route by URL.
- Submitted Daily Log cannot be edited by creator until returned.
- Assigned verifier can open full Daily Log and verify/return.
- Verifier receives in-app notification and notification click opens the correct entity.
- FastCons Khối lượng persists after save/reopen/verify.
- Verified Daily Log updates schedule progress when task link and provisional quantity exist.
- BOQ sync from schedule creates/updates tree and does not overwrite manual data.
- Double clicking submit/save/status buttons does not create duplicate records.

## Current Session Outcome Summary

Major work completed or planned through this session:

- Supabase cloud migration workflow established; local DB is not used.
- Workflow approval failure investigated and DB/RPC path hardened.
- Permission and notification plan implemented across Daily Log/Workflow/RQ direction.
- Notification deep-link resolver added for Daily Log, Workflow, RQ fallback links.
- Daily Log RLS/status transition fixed using cloud migration and RPC-style service.
- Daily Log creator/reviewer lock rules implemented in UI/service.
- Submit verifier picker uses Project Organization users with `verify` permission and sends notification.
- FastCons modal widened.
- Double-submit prevention added for Daily Log save/status actions.
- Daily Log volume persistence fixed by sanitizing empty UUIDs and throwing detail-write errors.
- FastCons Khối lượng now uses completion-style entry with evidence and task search.
- Daily Log full viewer added so reviewers can inspect the whole phiếu.
- Legacy completion-request UI removed from visible schedule flow; source is now verified Daily Log.
- Gantt task form no longer shows ineffective Lag/Nhân lực/Loại TN/Chi phí/ngày controls.
- Project BOQ sync model introduced; original contract BOQ remains read-only reference.

When starting a new session, first run:

```bash
git status --short
```

Then inspect relevant files before editing. Do not assume the previous session's changes are committed.
