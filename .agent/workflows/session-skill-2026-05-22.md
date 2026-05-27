---
name: khotienthinh-session-handoff-2026-05-22
description: Use when continuing work in /Users/admin/khotienthinh on the VIOO/FastCons ERP project after the 2026-05-22 session. Contains current branch state, Supabase cloud-only migration caveats, FastCons construction business rules, BOQ reconciliation decisions, material request/PO rules, Daily Log constraints, GitHub push protection notes, and collaboration conventions with anh.
license: private
---

# Khotienthinh Session Handoff - 2026-05-22

Read this before making code changes in `/Users/admin/khotienthinh`.

The user is Vietnamese and expects direct anh/em communication. Keep responses pragmatic, concrete, and implementation-focused. Read code before changing it, do not guess from memory, and do not break flows that already work.

Important workflow governance update from 2026-05-26:

- Before changing any draft/submission/approval/return/rejection/completion, user handoff, delete/rollback, inventory, cost, payment, or real-world side-effect flow, read:
  - `.agent/workflows/fastcons-workflow-governance-skill-2026-05-26.md`
- Core rule: every action must have a confirm dialog, write traceable audit/system history, respect current-step ownership, and Admin cannot bypass physical/financial reality.

## Collaboration Rules

- Address the user as `anh`; refer to self as `em`.
- Prefer direct execution over long proposals once anh approves.
- If the user asks to analyze only, do not code yet.
- If the user says `Duyệt triển khai`, implement and verify.
- Always preserve good existing flows. Make narrow changes scoped to the requested module.
- Use `rg` / `rg --files` first for search.
- Use `apply_patch` for manual file edits.
- Do not use Python for simple file read/write.
- Worktree may be dirty. Never revert unrelated user changes.
- After TypeScript/UI changes, run:
  - `npm run lint`
  - `npm run build`
- Do not commit or push unless anh asks.
- Never commit `.env`, tokens, service-role keys, or local credentials.

## Current Git State To Remember

At the time this file was created:

- Current branch: `feature/fastcons-boq-payment`
- Remote: `https://github.com/hoangnvthkt/khotienthinh.git`
- Branch had already been pushed successfully after removing `.env` from a blocked commit.
- Local branch showed `ahead 2` vs origin before the latest uncommitted edits.
- Current uncommitted files from the last task:
  - `components/project/DailyLogDetailTabs.tsx`
  - `pages/project/DailyLogTab.tsx`
  - `types.ts`
- `components/RequestModal.tsx` was intentionally rolled back after a mistaken scope change and should have no diff from that mistake.

Important GitHub note:

- GitHub push protection blocked a previous push because `.env` contained a Supabase Personal Access Token in commit `f91d9fd...`.
- The commit was amended into `9dfc938...` and pushed successfully.
- `.env` is ignored by `.gitignore`, but it had been tracked before. Always verify:
  ```bash
  git ls-files .env
  git grep -n 'sbp_' HEAD
  ```
  Both should return no results before pushing.
- Treat any token that appeared in terminal/chat as compromised. Do not print it again.

## Supabase Rules

Always use the Supabase skill for database/storage/auth/function tasks.

Current project convention:

- No local Supabase DB.
- Schema changes are cloud-only unless anh explicitly changes this strategy.
- Do not run destructive DB commands.
- Do not run `supabase db reset`.
- Be very careful with `supabase db push` because some migrations were applied cloud-only and not recorded in migration history.

Cloud-only migration reality as of this session:

- Supabase Dashboard `Database Migrations` showed latest recorded migration:
  - `20260521040913_boq_reconciliation_groups`
- The following later migrations were checked and their schema effects were present on cloud, but they were not recorded in migration history:
  - `20260521064928_project_material_requests_po_links`
  - `20260521080229_web_push_notification_trigger`
  - `20260521092131_fix_contract_acceptance_payment_guards`
  - `20260521150644_wms_global_keeper_project_demand_requests`
- Meaning: Dashboard may look behind, but schema objects exist. Future `db push` may still think these are local-only/pending unless migration history is repaired/baselined.

Baseline capture created:

- `supabase/baseline/2026-05-21/README.md`
- `supabase/baseline/2026-05-21/schema_inventory.sql`
- `supabase/baseline/2026-05-21/cloud_public_schema_inventory.json`
- `supabase/baseline/2026-05-21/cloud_public_schema_inventory.pretty.json`
- `supabase/baseline/2026-05-21/migration_list_linked.txt`
- `supabase/baseline/2026-05-21/db_dump_dry_run.txt`

Baseline limits:

- Public schema inventory was captured.
- `supabase db dump` did not produce a restore-grade dump because Docker was unavailable and local `pg_dump` was older than cloud Postgres.
- Do not claim a full clean baseline exists yet.

Recommended long-term DB cleanup:

- First capture a restore-grade schema dump with a compatible `pg_dump` or Supabase-supported path.
- Then decide a migration-history repair/baseline strategy.
- Do not casually delete old migrations without a tested restore path.

## Core Business Goal

The product is a construction ERP focused on:

- Evaluating bidding/design BOQ quality vs construction execution reality.
- Tracking site progress and verified quantities.
- Detecting bottlenecks early.
- Tracking cash flow, payment due dates, owner/subcontractor payment progress.
- Comparing final project BOQ vs actual execution across quantity, unit price, amount, schedule, and materials.

All departments should ultimately anchor their work to **BOQ triển khai** where applicable, while still allowing exceptions and variations with reasons.

## Contract And Project Model

Decisions already agreed:

- `1 hợp đồng = 1 dự án`.
- Contract BOQ and construction BOQ are separate trees.
- Contract BOQ is commercial/signed.
- Construction BOQ is internal execution breakdown and may be presented differently.
- Do not model construction progress as a direct structural child of contract BOQ.
- Use reconciliation groups for comparison.

BOQ reconciliation model:

- Contract BOQ and construction BOQ map through `boq_reconciliation_groups`.
- Supporting tables:
  - `boq_reconciliation_contract_lines`
  - `boq_reconciliation_work_lines`
- Mapping can be many-to-many.
- Mapping can include allocation quantity, original/converted unit, conversion factor/formula, amount snapshot, note.
- Statuses: `draft`, `submitted`, `reviewed`, `locked`.
- Only `reviewed`/`locked` groups should feed official reports/payment suggestions.

Compatibility:

- Keep `task_contract_items` for temporary compatibility.
- It is no longer the main reconciliation model.

## Daily Log / FastCons Rules

Daily Log is the source of actual execution progress after verification.

Status rules:

- `draft`: creator can edit/send.
- `submitted`: selected verifier can verify/return.
- `verified`: locked except admin.
- `rejected`: creator can edit and resubmit.
- Do not let creator edit a submitted/verified log unless returned or admin.
- Use status transition RPC/service for status changes; avoid rewriting full detail rows on status-only changes.

Progress rule:

- Verified Daily Log volume rows are the source of real progress.
- Volume rows should link to:
  - `taskId` / `taskName`
  - optionally `workBoqItemId` / `workBoqItemName`
  - `quantity`
  - `unit`
- Denominator is task `provisionalQuantity` or work BOQ `plannedQty` depending on selected row.
- Parent progress is derived from children.

Latest rule from 2026-05-22:

- In `Ghi nhật ký công trường > Chi tiết thi công (FastCons) > Khối lượng`, users must not enter quantity above `Còn lại` when the task/BOQ has a planned quantity.
- The surplus does not have a valid place to go automatically.
- Surplus must be split into:
  - phát sinh/variation,
  - another BOQ triển khai item,
  - or another task/line with proper context.
- The UI now caps input and save validation rejects over-limit rows.

File evidence rule:

- Daily Log site photos upload to Supabase Storage and display fine.
- FastCons volume attachments were base64/data URL evidence.
- JPG attachments could render blank if MIME was missing/incorrect.
- Current fix infers/normalizes MIME for `.jpg/.jpeg/.png/.gif/.webp/.bmp` when attaching and when rendering old attachments.

## Daily Log FastCons Materials Rule

Important correction from anh:

- Do **not** solve site stock lookup in `Tổng quan dự án > Vật tư > Yêu cầu` for this request.
- The requested scope is:
  - `Ghi nhật ký công trường`
  - `Chi tiết thi công (FastCons)`
  - tab `Vật tư`

Agreed behavior:

- When recording materials used in Daily Log, the material should be chosen from stock of the **site warehouse for that construction site**.
- Example: project/site RICO should use stock from `Kho Công trường RICO`.
- The code currently attempts to match a site warehouse by construction site name against WMS warehouses of type `SITE`.
- If matched, the material picker filters to items with stock > 0 in that site warehouse.
- Quantity input is capped by the stock in that site warehouse.
- Save validation blocks selected WMS materials exceeding that site warehouse stock.
- If no site warehouse is matched, show a warning and allow manual text, but do not pretend a stock scope exists.

Current implementation files:

- `components/project/DailyLogDetailTabs.tsx`
- `pages/project/DailyLogTab.tsx`
- `types.ts`

Potential future improvement:

- Add an explicit `construction_site_id` or `site_warehouse_id` relation on `warehouses` instead of fuzzy name matching.
- Until then, name matching is a pragmatic bridge.

## Project Material Request And PO Rules

Material request flow is at:

- `Tổng quan dự án > Vật tư > Yêu cầu`

Do not replace the existing WMS request flow. Extend it carefully.

Agreed material request model:

- Keep `requests` as the WMS/project request source.
- Project requests add:
  - `projectId`
  - `constructionSiteId`
  - `requestOrigin = project|wms`
- Request item line-level links:
  - `lineId`
  - `workBoqItemId`
  - `materialBudgetItemId`
  - `neededDate`
  - `note`
  - snapshots
  - `overBudgetReason`
- One request can contain materials from many BOQ triển khai items.
- Warning compares against `material_budget_items.budgetQty`.
- Pending requests are included in warning.
- Rejected requests are excluded.
- Over budget or outside BOQ requires reason, but does not block submission.

Procurement/warehouse logic:

- Site users know receiving warehouse, not necessarily source warehouse.
- If source warehouse is not selected, request goes to global warehouse keeper/material department.
- `WAREHOUSE_KEEPER` with no `assignedWarehouseId` means phòng vật tư/thủ kho tổng.
- Site users can see demand and stock context, but phòng vật tư decides whether to issue from stock or buy.
- Direct consumption mode exists for materials like sand/stone where stock receiving may not be appropriate.

PO rules:

- PO can be created from one or many request lines.
- PO can also be proactive:
  - project proactive purchase
  - stock reserve purchase
- PO line to request line mapping table exists.
- PO statuses:
  - `draft`
  - `sent`
  - `confirmed`
  - `in_transit`
  - `partial`
  - `delivered`
  - `closed`
  - `cancelled`
- Receiving updates `receivedQty`.
- Partial receiving sets `partial`; full receiving sets `delivered`.
- Do not auto-close project request at PO creation; request completion follows receiving/issue flow.

## Contract / Acceptance / Payment Notes

Contract Workspace, Variation, Daily Log, Gantt, Payment Certificate flows are considered valuable and should not be broken.

Known fixes and rules:

- Contract items with approved/paid downstream documents should be locked against unsafe edit/delete.
- Quantity acceptance with owner is based on contract BOQ, not construction BOQ.
- Daily Log generated suggestions for acceptance should only use reviewed/locked reconciliation groups.
- Unmapped construction quantities stay in `Chưa map`, not auto-accepted.
- Payment certificates should support view/edit/return according to status and permissions.

If a user says they cannot view/edit/delete an acceptance/payment record, inspect:

- panel UI actions,
- service methods,
- status transition guards,
- RLS/RPC behavior,
- whether the record is locked by downstream paid/approved documents.

## Web Push Notes

Web push DB-side foundation exists:

- `pg_net`
- `supabase_vault`
- private function/trigger for notification push

But browser push when app/browser is closed requires:

- `VITE_VAPID_PUBLIC_KEY`
- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `VAPID_SUBJECT`
- `SEND_WEB_PUSH_SECRET`
- deploy Edge Function `send-web-push`

Do not claim end-to-end push works until secrets and function deployment are verified.

## UI / Frontend Preferences

- Build actual working screens, not landing pages.
- For operational ERP screens, keep UI dense, restrained, scan-friendly.
- Use existing design conventions.
- Avoid decorative overwork.
- Prefer table/card hybrids only where mobile needs cards.
- Keep text from overflowing buttons/cards.
- Use icons from `lucide-react` where appropriate.
- For business data selection, prefer searchable picker/typeahead.

## Current Verification Status

The latest local changes from 2026-05-22 were verified with:

```bash
npm run lint
npm run build
```

Both passed.

Build warning about chunks larger than 500 kB is existing Vite bundle-size warning, not a failing build.

## Before Continuing Next Session

Do this first:

```bash
git status --short --branch
git diff --stat
git diff -- components/project/DailyLogDetailTabs.tsx pages/project/DailyLogTab.tsx types.ts
```

Then confirm whether anh wants:

- commit only,
- commit and push,
- open PR,
- or continue implementation.

If pushing:

```bash
git ls-files .env
git grep -n 'sbp_' HEAD
```

Both should be empty before `git push`.
