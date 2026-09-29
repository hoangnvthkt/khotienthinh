# Daily Log WBS Area Summary and Progress Publication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Cho phép nhiều cán bộ lập phiếu nguồn theo khu vực/WBS, bắt buộc khai báo nguồn cung cấp cho nhân công/máy, người tổng hợp chỉnh từng card và chỉ bản được CHT xác nhận mới công bố tiến độ cùng bằng chứng nguồn lực.

**Architecture:** Mở rộng daily_log_contributions và daily_log_summary_sources đang có, thêm daily_log_work_items cùng semantics nguồn lực/nguồn cung cấp chuẩn hóa và command RPC theo transaction. UI tách thành editor phiếu nguồn, workspace tổng hợp hai tầng và chế độ duyệt CHT; project_daily_task_progress tiếp tục là sổ tiến độ chính thức, còn chi tiết nhân công/máy của summary verified là bằng chứng vật lý, không chứa giá hoặc tiền.

**Tech Stack:** React 18, TypeScript 5.8, Vite 6, Vitest 4, Playwright 1.60, Supabase/PostgreSQL/RLS/RPC, Tailwind utility classes, lucide-react.

**Spec:** docs/superpowers/specs/2026-09-23-daily-log-wbs-progress-resources-cost-design.md

## Global Constraints

- Thực thi bằng agent chính với superpowers:executing-plans; AGENTS.md cấm sub-agent.
- Mọi thao tác Supabase dùng Supabase Cloud từ cấu hình .env; không dùng Supabase local hoặc Docker.
- Không ghi trực tiếp project_daily_task_progress, project_weekly_task_progress hoặc trạng thái workflow từ frontend.
- Phiếu nguồn không công bố tiến độ; chỉ bản tổng hợp member_contributions được CHT xác nhận mới công bố.
- Mỗi dòng nhân công/máy mới bắt buộc chọn nguồn danh mục hoặc nhập tay có loại và tên.
- Không đọc internal_price_book, không nhận/ghi unit_cost hoặc total_cost, không tạo accrual/project_transactions.
- Người tổng hợp sửa bản sao trong daily_log_summary_sources; không sửa ngược contribution gốc.
- Giá trị chưa biết lưu null và hiển thị “Chưa có cơ sở quy đổi”; không biến unknown thành 0.
- Không cộng hoặc lấy trung bình phần trăm lũy kế giữa các khu vực.
- Giữ nguyên dữ liệu daily_log_volumes lịch sử; không backfill WBS/khu vực bằng suy đoán.
- Giữ Design System hiện tại; không thêm thư viện UI hoặc redesign ngoài tab Nhật ký/Chốt tiến độ.
- Ngày hiển thị dd/mm/yyyy; giá trị database/RPC dùng ISO yyyy-mm-dd.
- Dùng TDD, command idempotent, optimistic concurrency và commit riêng sau mỗi task.

## Review Focus

1. Cùng task_id xuất hiện ở nhiều khu vực nhưng không có area planned quantity: không tự tính phần trăm; bắt người tổng hợp chốt giá trị chính thức và lưu cảnh báo — Task 1, 4, 6, 7.
2. Contribution đổi sau khi đã chụp snapshot: giữ bản chỉnh hiện tại, báo source_changed và chỉ cập nhật khi người tổng hợp chủ động — Task 4, 6.
3. Hai lần duyệt hoặc retry sau mất mạng: chỉ một progress row/task/day và một receipt cho command_id — Task 7.
4. Ngày hoặc tuần bị khóa, hoặc baseline trước/sau đã đổi: command rollback toàn bộ và trả lỗi có thể hành động — Task 7, 9.
5. NCC bị khóa, nguồn nhập tay thiếu loại/tên hoặc payload cố gửi giá/tiền: giữ snapshot để xem nhưng chặn gửi nguồn không hợp lệ; command không ghi cột giá legacy — Task 1, 2, 4, 5, 7.

## File Map

**Tạo mới:**

- lib/dailyLogWorkItemRules.ts: công thức tiến độ, tổng hợp theo khu vực và conflict model.
- lib/dailyLogResourceRules.ts: semantics nhân công/máy và validation hai mode nguồn cung cấp.
- lib/dailyLogWbsService.ts: adapter cho bundle, contribution draft, summary draft, submit, publish và revision RPC.
- components/project/daily-log/DailyLogWbsPicker.tsx: drawer chọn leaf WBS.
- components/project/daily-log/DailyLogWorkItemTable.tsx: bảng WBS desktop và card mobile.
- components/project/daily-log/DailyLogResourceEditor.tsx: editor nhân công/máy gắn work item.
- components/project/daily-log/DailyLogContributionWorkEditor.tsx: form phiếu nguồn.
- components/project/daily-log/DailyLogAreaCard.tsx: card người phụ trách + khu vực.
- components/project/daily-log/DailyLogSummaryWorkspace.tsx: workspace 2 tầng cho người tổng hợp/CHT.
- components/project/daily-log/DailyLogConsolidatedWbsTable.tsx: tổng hợp WBS và drill-down nguồn.
- components/project/daily-log/DailyLogSourceDiff.tsx: so sánh snapshot và bản đã chỉnh.
- supabase/migrations/20260923090000_daily_log_wbs_area_foundation.sql.
- supabase/migrations/20260923091500_daily_log_publish_progress_permission.sql.
- supabase/migrations/20260923093000_daily_log_wbs_area_commands.sql.
- supabase/migrations/20260923100000_daily_log_summary_progress_publication.sql.
- supabase/migrations/20260923101500_daily_progress_exception_command.sql.
- supabase/migrations/20260923103000_daily_log_summary_revisions.sql.
- supabase/tests/daily_log_wbs_area_foundation_smoke.sql.
- supabase/tests/daily_log_summary_progress_publication_smoke.sql.
- tests/e2e/daily-log-wbs-area-summary.spec.ts.
- Các unit/contract test nêu trong từng task.

**Sửa chính:**

- types.ts, lib/supabaseProjections.ts.
- lib/projectService.ts, lib/dailyLogDetailService.ts, lib/dailyLogWorkflow.ts, lib/dailyLogSummaryService.ts.
- lib/permissions/projectPermissionRooms.ts, lib/permissions/projectRoomEffectiveActions.ts, lib/permissions/projectPermissionRegistry.ts.
- pages/project/DailyLogTab.tsx, pages/project/WeeklyProgressTab.tsx.
- docs/runbooks/erp-completion-pilot-rollout.md và tài liệu evidence pilot.

---

### Task 1: Khóa kiểu dữ liệu, công thức WBS và semantics nguồn lực

**Files:**
- Create: lib/dailyLogWorkItemRules.ts
- Create: lib/__tests__/dailyLogWorkItemRules.test.ts
- Create: lib/dailyLogResourceRules.ts
- Create: lib/__tests__/dailyLogResourceRules.test.ts
- Modify: types.ts

**Interfaces:**
- Produces: DailyLogWorkItem, DailyLogWbsDecision, DailyLogResourceProvider, DailyLogLaborInput, DailyLogMachineInput, validateResourceProvider(), calculateLaborHours(), calculateMachineHours(), deriveWorkItemProgress(), deriveWorkItemProgressFromQuantity(), validateWorkItemProgressInput(), aggregateAreaWorkItems().
- Consumes: ProjectTask, ProjectWorkBoqItem và số liệu progress chính thức gần nhất.

- [ ] **Step 1: Viết test fail cho quy đổi, unknown và tổng hợp nhiều khu vực**

    import { describe, expect, it } from 'vitest';
    import {
      aggregateAreaWorkItems,
      deriveWorkItemProgress,
      deriveWorkItemProgressFromQuantity,
      validateWorkItemProgressInput,
    } from '../dailyLogWorkItemRules';
    import {
      calculateLaborHours,
      calculateMachineHours,
      validateResourceProvider,
    } from '../dailyLogResourceRules';

    describe('dailyLogWorkItemRules', () => {
      it('derives cumulative and daily quantities from percent', () => {
        expect(deriveWorkItemProgress({
          plannedQuantity: 200,
          previousCumulativeQuantity: 60,
          cumulativePercent: 40,
        })).toEqual({
          cumulativePercent: 40,
          cumulativeQuantity: 80,
          dailyQuantity: 20,
          conversionStatus: 'ready',
        });
      });

      it('derives percent and daily quantity from cumulative quantity', () => {
        expect(deriveWorkItemProgressFromQuantity({
          plannedQuantity: 200,
          previousCumulativeQuantity: 60,
          cumulativeQuantity: 80,
        })).toMatchObject({ cumulativePercent: 40, cumulativeQuantity: 80, dailyQuantity: 20 });
      });

      it('rejects conflicting percent and cumulative quantity inputs', () => {
        expect(validateWorkItemProgressInput({
          plannedQuantity: 200,
          cumulativePercent: 40,
          cumulativeQuantity: 90,
        })).toEqual({ valid: false, errorCode: 'inconsistent_progress_inputs' });
      });

      it('keeps quantities unknown when planned quantity is missing', () => {
        expect(deriveWorkItemProgress({
          plannedQuantity: null,
          previousCumulativeQuantity: null,
          cumulativePercent: 25,
        })).toMatchObject({
          cumulativePercent: 25,
          cumulativeQuantity: null,
          dailyQuantity: null,
          conversionStatus: 'missing_planned_quantity',
        });
      });

      it('requires an official cumulative value for the same task without area allocation', () => {
        const result = aggregateAreaWorkItems([
          { id: 'a', taskId: 'task-1', workAreaCode: 'A', areaPlannedQuantity: null, cumulativePercent: 30, dailyQuantity: 5 },
          { id: 'b', taskId: 'task-1', workAreaCode: 'B', areaPlannedQuantity: null, cumulativePercent: 45, dailyQuantity: 7 },
        ]);
        expect(result[0].conflicts).toContain('missing_area_allocation');
        expect(result[0].officialCumulativePercent).toBeNull();
      });

      it('weights the same task by allocated planned quantity', () => {
        const result = aggregateAreaWorkItems([
          { id: 'a', taskId: 'task-1', workAreaCode: 'A', areaPlannedQuantity: 100, cumulativePercent: 20, dailyQuantity: 5 },
          { id: 'b', taskId: 'task-1', workAreaCode: 'B', areaPlannedQuantity: 300, cumulativePercent: 60, dailyQuantity: 7 },
        ]);
        expect(result[0].officialCumulativePercent).toBe(50);
        expect(result[0].dailyQuantity).toBe(12);
      });
    });

    describe('dailyLogResourceRules', () => {
      it('accepts a catalog provider snapshot', () => {
        expect(validateResourceProvider({
          entryMode: 'catalog',
          partnerId: 'partner-1',
          providerCodeSnapshot: 'NCC-001',
          providerNameSnapshot: 'Công ty An Phát',
        })).toEqual({ valid: true, errorCode: null });
      });

      it('requires type and name for a manual provider', () => {
        expect(validateResourceProvider({
          entryMode: 'manual',
          manualProviderType: 'day_labor',
          manualProviderName: '',
        })).toEqual({ valid: false, errorCode: 'manual_provider_name_required' });
      });

      it('calculates only physical usage', () => {
        expect(calculateLaborHours({ peopleCount: 5, hoursPerPerson: 6 })).toBe(30);
        expect(calculateMachineHours({ machineCount: 2, hoursPerMachine: 7.5 })).toBe(15);
      });
    });

- [ ] **Step 2: Chạy test để xác nhận fail**

Run: npm test -- lib/__tests__/dailyLogWorkItemRules.test.ts lib/__tests__/dailyLogResourceRules.test.ts

Expected: FAIL vì module và types chưa tồn tại.

- [ ] **Step 3: Thêm types chính xác**

    export type DailyLogWorkOwnerType = 'contribution' | 'summary_source';
    export type DailyLogWorkConversionStatus = 'ready' | 'missing_planned_quantity';
    export type DailyLogWorkConflictCode =
      | 'missing_area_allocation'
      | 'duplicate_daily_quantity'
      | 'forecast_mismatch'
      | 'source_changed'
      | 'source_returned';

    export interface DailyLogWorkItem {
      id?: string;
      ownerType: DailyLogWorkOwnerType;
      contributionId?: string | null;
      dailyLogId?: string | null;
      summarySourceId?: string | null;
      sourceWorkItemId?: string | null;
      taskId: string;
      workBoqItemId?: string | null;
      workAreaCode: string;
      workAreaName: string;
      wbsCode?: string | null;
      taskName: string;
      unit?: string | null;
      plannedQuantity?: number | null;
      areaPlannedQuantity?: number | null;
      baselineProgressPercent: number;
      baselineQuantityDone?: number | null;
      cumulativeProgressPercent: number;
      cumulativeQuantityDone?: number | null;
      dailyQuantityDone?: number | null;
      scheduleFinishDate?: string | null;
      forecastFinishDate?: string | null;
      forecastChangeReason?: string | null;
      note?: string | null;
      attachments?: Attachment[];
    }

    export interface DerivedWorkItemProgress {
      cumulativePercent: number;
      cumulativeQuantity: number | null;
      dailyQuantity: number | null;
      conversionStatus: DailyLogWorkConversionStatus;
    }

    export interface AggregatedDailyLogWorkItem {
      taskId: string;
      officialCumulativePercent: number | null;
      cumulativeQuantity: number | null;
      dailyQuantity: number | null;
      conflicts: DailyLogWorkConflictCode[];
      sourceWorkItemIds: string[];
    }

    export interface DailyLogWbsDecision {
      id?: string;
      dailyLogId: string;
      taskId: string;
      officialCumulativePercent: number;
      officialCumulativeQuantity?: number | null;
      officialDailyQuantity?: number | null;
      forecastFinishDate?: string | null;
      aggregationMethod: 'single_source' | 'weighted_area_allocation' | 'manual_override';
      dailyQuantityMethod: 'sum_non_overlapping' | 'keep_selected_sources' | 'manual_override';
      includedSourceWorkItemIds: string[];
      resolutionReason?: string | null;
      forecastResolutionReason?: string | null;
      sourceFingerprint: string;
    }

    export type DailyLogProviderEntryMode = 'catalog' | 'manual';
    export type DailyLogManualProviderType =
      | 'free_crew'
      | 'day_labor'
      | 'unregistered_provider'
      | 'machine_owner'
      | 'unregistered_rental_provider'
      | 'other';

    export interface DailyLogResourceProvider {
      entryMode: DailyLogProviderEntryMode;
      partnerId?: string | null;
      providerCodeSnapshot?: string | null;
      providerNameSnapshot?: string | null;
      manualProviderType?: DailyLogManualProviderType | null;
      manualProviderName?: string | null;
      manualProviderNote?: string | null;
    }

    export interface DailyLogLaborInput {
      workItemClientKey: string;
      workItemId?: string | null;
      provider: DailyLogResourceProvider;
      laborType: string;
      peopleCount: number;
      hoursPerPerson: number;
      note?: string | null;
    }

    export interface DailyLogMachineInput {
      workItemClientKey: string;
      workItemId?: string | null;
      provider: DailyLogResourceProvider;
      machineType: string;
      machineCount: number;
      hoursPerMachine: number;
      note?: string | null;
    }

- [ ] **Step 4: Implement công thức thuần**

    export const deriveWorkItemProgress = (input: {
      plannedQuantity: number | null;
      previousCumulativeQuantity: number | null;
      cumulativePercent: number;
    }): DerivedWorkItemProgress => {
      if (!Number.isFinite(input.plannedQuantity) || Number(input.plannedQuantity) <= 0) {
        return {
          cumulativePercent: input.cumulativePercent,
          cumulativeQuantity: null,
          dailyQuantity: null,
          conversionStatus: 'missing_planned_quantity',
        };
      }
      const cumulativeQuantity = Number(input.plannedQuantity) * input.cumulativePercent / 100;
      return {
        cumulativePercent: input.cumulativePercent,
        cumulativeQuantity,
        dailyQuantity: cumulativeQuantity - Number(input.previousCumulativeQuantity || 0),
        conversionStatus: 'ready',
      };
    };

    export const deriveWorkItemProgressFromQuantity = (input: {
      plannedQuantity: number;
      previousCumulativeQuantity: number | null;
      cumulativeQuantity: number;
    }): DerivedWorkItemProgress => ({
      cumulativePercent: input.cumulativeQuantity / input.plannedQuantity * 100,
      cumulativeQuantity: input.cumulativeQuantity,
      dailyQuantity: input.cumulativeQuantity - Number(input.previousCumulativeQuantity || 0),
      conversionStatus: 'ready',
    });

    export const validateWorkItemProgressInput = (input: {
      plannedQuantity: number;
      cumulativePercent: number;
      cumulativeQuantity: number;
    }) => Math.abs(input.plannedQuantity * input.cumulativePercent / 100 - input.cumulativeQuantity) <= 0.0001
      ? { valid: true as const, errorCode: null }
      : { valid: false as const, errorCode: 'inconsistent_progress_inputs' as const };

Server/UI dùng cùng tolerance và decimal rounding helper hiện có. `deriveWorkItemProgressFromQuantity()` chỉ được gọi khi plannedQuantity dương; nếu thiếu planned quantity, UI chỉ cho nhập phần trăm. Validation bổ sung rule không giảm so với baseline, không vượt progress ngày kế tiếp khi backdate và tôn trọng cấu hình over-100 của leaf task. `aggregateAreaWorkItems()` nhóm theo taskId. Chỉ tính phần trăm có trọng số khi mọi dòng có areaPlannedQuantity dương; nếu không thì officialCumulativePercent = null và thêm missing_area_allocation. Không tự lấy max hoặc average.

`validateResourceProvider()` chấp nhận đúng một mode. Mode `catalog` bắt buộc partnerId/providerNameSnapshot và không nhận manual fields. Mode `manual` bắt buộc manualProviderType/manualProviderName và partnerId phải null. `calculateLaborHours()` và `calculateMachineHours()` chỉ nhân hai đại lượng dương, làm tròn 4 chữ số và không có tham số giá/tiền.

    export const calculateLaborHours = (input: { peopleCount: number; hoursPerPerson: number }) =>
      Math.round(input.peopleCount * input.hoursPerPerson * 10_000) / 10_000;

    export const calculateMachineHours = (input: { machineCount: number; hoursPerMachine: number }) =>
      Math.round(input.machineCount * input.hoursPerMachine * 10_000) / 10_000;

    export const validateResourceProvider = (provider: DailyLogResourceProvider) => {
      if (provider.entryMode === 'catalog') {
        return provider.partnerId && provider.providerNameSnapshot?.trim()
          ? { valid: true as const, errorCode: null }
          : { valid: false as const, errorCode: 'catalog_provider_required' as const };
      }
      if (!provider.manualProviderType) {
        return { valid: false as const, errorCode: 'manual_provider_type_required' as const };
      }
      return provider.manualProviderName?.trim()
        ? { valid: true as const, errorCode: null }
        : { valid: false as const, errorCode: 'manual_provider_name_required' as const };
    };

- [ ] **Step 5: Chạy unit test và typecheck**

Run: npm test -- lib/__tests__/dailyLogWorkItemRules.test.ts lib/__tests__/dailyLogResourceRules.test.ts

Run: npm run lint

Expected: PASS.

- [ ] **Step 6: Commit**

    git add types.ts lib/dailyLogWorkItemRules.ts lib/dailyLogResourceRules.ts lib/__tests__/dailyLogWorkItemRules.test.ts lib/__tests__/dailyLogResourceRules.test.ts
    git commit -m "feat(daily-log): define WBS and resource evidence rules"

---

### Task 2: Tạo schema chuẩn hóa, ownership và rollout gate

**Files:**
- Create: supabase/migrations/20260923090000_daily_log_wbs_area_foundation.sql
- Create: supabase/tests/daily_log_wbs_area_foundation_smoke.sql
- Create: lib/__tests__/dailyLogWbsAreaFoundationMigration.test.ts
- Modify: lib/supabaseProjections.ts

**Interfaces:**
- Consumes: daily_log_contributions, daily_log_summary_sources, daily_logs, daily_log_labor, daily_log_machines, project_tasks, project_work_boq_items.
- Produces: daily_log_work_items, daily_log_wbs_decisions, typed provider/resource columns, owner constraints, RLS and get_daily_log_wbs_rollout_access_v1().

- [ ] **Step 1: Viết migration contract test fail**

    const sql = readFileSync(
      join(process.cwd(), 'supabase/migrations/20260923090000_daily_log_wbs_area_foundation.sql'),
      'utf8',
    );

    expect(sql).toContain('create table public.daily_log_work_items');
    expect(sql).toContain('create table public.daily_log_wbs_decisions');
    expect(sql).toContain('daily_log_work_items_owner_check');
    expect(sql).toContain('work_area_name');
    expect(sql).toContain('source_fingerprint');
    expect(sql).toContain('provider_entry_mode');
    expect(sql).toContain('manual_provider_name');
    expect(sql).toContain('resource_semantics_version');
    expect(sql).toContain('daily_log_labor_provider_check');
    expect(sql).toContain('daily_log_machines_provider_check');
    expect(sql).toContain('get_daily_log_wbs_rollout_access_v1');
    expect(sql).toContain('enable row level security');
    expect(sql).not.toContain('grant insert, update, delete on public.daily_log_work_items to authenticated');

- [ ] **Step 2: Chạy contract test để xác nhận fail**

Run: npm test -- lib/__tests__/dailyLogWbsAreaFoundationMigration.test.ts

Expected: FAIL vì migration chưa tồn tại.

- [ ] **Step 3: Tạo DDL additive và owner constraint**

    alter table public.daily_log_contributions
      add column work_area_code text,
      add column work_area_name text,
      add column row_version bigint not null default 1,
      add column source_fingerprint text;

    alter table public.daily_log_summary_sources
      add column sort_order integer not null default 0,
      add column source_version bigint,
      add column source_fingerprint text,
      add column source_snapshot jsonb not null default '{}'::jsonb,
      add column source_state text not null default 'current',
      add column work_area_code text,
      add column work_area_name text,
      add column has_adjustments boolean not null default false,
      add column adjustment_reason text,
      add column adjusted_by text,
      add column adjusted_at timestamptz,
      add column review_status text not null default 'draft',
      add column review_comment text,
      add column reviewed_by text,
      add column reviewed_at timestamptz;

    alter table public.daily_log_summary_sources
      add constraint daily_log_summary_sources_source_state_check
        check (source_state in ('current','changed','returned','missing')),
      add constraint daily_log_summary_sources_review_status_check
        check (review_status in ('draft','ready','change_requested','accepted','superseded'));

    create table public.daily_log_work_items (
      id uuid primary key default gen_random_uuid(),
      contribution_id uuid references public.daily_log_contributions(id) on delete cascade,
      daily_log_id text references public.daily_logs(id) on delete cascade,
      summary_source_id uuid references public.daily_log_summary_sources(id) on delete cascade,
      source_work_item_id uuid,
      project_id text,
      construction_site_id text,
      task_id text not null references public.project_tasks(id) on delete restrict,
      work_boq_item_id text references public.project_work_boq_items(id) on delete set null,
      work_area_code text not null,
      work_area_name_snapshot text not null,
      wbs_code_snapshot text,
      task_name_snapshot text not null,
      unit_snapshot text,
      planned_quantity_snapshot numeric,
      area_planned_quantity_snapshot numeric,
      baseline_progress_percent numeric not null,
      baseline_quantity_done numeric,
      baseline_progress_row_id uuid,
      baseline_fingerprint text not null,
      cumulative_progress_percent numeric not null,
      cumulative_quantity_done numeric,
      daily_quantity_done numeric,
      schedule_finish_date_snapshot date,
      forecast_finish_date date,
      forecast_change_reason text,
      note text,
      attachments jsonb not null default '[]'::jsonb,
      source_index integer not null default 0,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      constraint daily_log_work_items_owner_check check (
        (contribution_id is not null and daily_log_id is null and summary_source_id is null)
        or
        (contribution_id is null and daily_log_id is not null and summary_source_id is not null)
      )
    );

    create table public.daily_log_wbs_decisions (
      id uuid primary key default gen_random_uuid(),
      daily_log_id text not null references public.daily_logs(id) on delete cascade,
      task_id text not null references public.project_tasks(id) on delete restrict,
      official_cumulative_percent numeric not null,
      official_cumulative_quantity numeric,
      official_daily_quantity numeric,
      forecast_finish_date date,
      aggregation_method text not null check (
        aggregation_method in ('single_source','weighted_area_allocation','manual_override')
      ),
      daily_quantity_method text not null check (
        daily_quantity_method in ('sum_non_overlapping','keep_selected_sources','manual_override')
      ),
      included_source_work_item_ids jsonb not null default '[]'::jsonb,
      resolution_reason text,
      forecast_resolution_reason text,
      source_fingerprint text not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (daily_log_id, task_id),
      check (official_cumulative_percent between 0 and 100),
      check (
        aggregation_method <> 'manual_override'
        or nullif(trim(resolution_reason), '') is not null
      ),
      check (
        daily_quantity_method <> 'manual_override'
        or nullif(trim(resolution_reason), '') is not null
      ),
      check (jsonb_typeof(included_source_work_item_ids) = 'array')
    );

    alter table public.daily_log_labor
      alter column daily_log_id drop not null,
      add column daily_log_work_item_id uuid references public.daily_log_work_items(id),
      add column contribution_id uuid references public.daily_log_contributions(id),
      add column summary_source_id uuid references public.daily_log_summary_sources(id),
      add column source_labor_line_id uuid,
      add column people_count numeric,
      add column hours_per_person numeric,
      add column total_labor_hours numeric,
      add column provider_entry_mode text,
      add column provider_code_snapshot text,
      add column provider_name_snapshot text,
      add column manual_provider_type text,
      add column manual_provider_name text,
      add column manual_provider_note text,
      add column resource_semantics_version integer not null default 1;

    alter table public.daily_log_machines
      alter column daily_log_id drop not null,
      add column daily_log_work_item_id uuid references public.daily_log_work_items(id),
      add column contribution_id uuid references public.daily_log_contributions(id),
      add column summary_source_id uuid references public.daily_log_summary_sources(id),
      add column source_machine_line_id uuid,
      add column machine_count numeric,
      add column hours_per_machine numeric,
      add column total_machine_hours numeric,
      add column provider_entry_mode text,
      add column provider_code_snapshot text,
      add column provider_name_snapshot text,
      add column manual_provider_type text,
      add column manual_provider_name text,
      add column manual_provider_note text,
      add column resource_semantics_version integer not null default 1;

    alter table public.daily_log_labor
      add constraint daily_log_labor_provider_check check (
        resource_semantics_version = 1
        or (provider_entry_mode = 'catalog' and partner_id is not null and nullif(trim(provider_name_snapshot), '') is not null and manual_provider_name is null)
        or (provider_entry_mode = 'manual' and partner_id is null and manual_provider_type in ('free_crew','day_labor','unregistered_provider','other') and nullif(trim(manual_provider_name), '') is not null)
      );

    alter table public.daily_log_machines
      add constraint daily_log_machines_provider_check check (
        resource_semantics_version = 1
        or (provider_entry_mode = 'catalog' and partner_id is not null and nullif(trim(provider_name_snapshot), '') is not null and manual_provider_name is null)
        or (provider_entry_mode = 'manual' and partner_id is null and manual_provider_type in ('machine_owner','unregistered_rental_provider','other') and nullif(trim(manual_provider_name), '') is not null)
      );

Thêm owner checks/partial indexes cho labor/machines trước khi drop NOT NULL; bản ghi mới luôn dùng `resource_semantics_version = 2`, còn dòng cũ giữ version 1 và không bị backfill. `unit_cost`/`total_cost` legacy vẫn tồn tại để đọc lịch sử nhưng command mới không ghi. `daily_log_wbs_decisions` là bản quyết định chính thức theo task của phiếu tổng hợp, tách khỏi các row nguồn theo khu vực để publish/retry không phải suy diễn lại từ UI.

- [ ] **Step 4: Tạo fail-closed rollout gate theo scope/date**

    create table app_private.daily_log_wbs_rollout_scopes (
      id uuid primary key default gen_random_uuid(),
      project_id text,
      construction_site_id text,
      mode text not null check (mode in ('off','pilot','enforced','paused')),
      cutover_date date not null,
      reason text not null,
      created_by uuid references public.users(id),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique nulls not distinct (project_id, construction_site_id)
    );

get_daily_log_wbs_rollout_access_v1() chỉ trả mode, cutoverDate và enabled cho actor có daily_log view. Không cấp SELECT trực tiếp app_private cho authenticated.

- [ ] **Step 5: Thêm RLS và projection**

RLS work item/resource dùng helper app_private dựa trên owner:

- contribution: daily_log_contribution_can_view/update.
- summary source: daily_log_can_select/edit.
- direct INSERT/UPDATE/DELETE của authenticated bị revoke; chỉ RPC command ghi.

Cập nhật projection cho contribution, summary source, work items, labor và machines với toàn bộ cột mới.

- [ ] **Step 6: Viết Cloud smoke có rollback**

Smoke tạo contribution ở scope fixture và một work item hợp lệ bằng payload đầy đủ của command được bổ sung ở Task 4. Ở task này chỉ kiểm tra DDL, owner check, unique indexes, RLS SELECT và rollout default off; command check được kích hoạt sau Task 4.

- [ ] **Step 7: Chạy kiểm tra**

Run: npm test -- lib/__tests__/dailyLogWbsAreaFoundationMigration.test.ts

Run: npm run check:supabase-migrations

Expected: PASS.

- [ ] **Step 8: Commit**

    git add supabase/migrations/20260923090000_daily_log_wbs_area_foundation.sql supabase/tests/daily_log_wbs_area_foundation_smoke.sql lib/__tests__/dailyLogWbsAreaFoundationMigration.test.ts lib/supabaseProjections.ts
    git commit -m "feat(daily-log): add WBS area data foundation"

---

### Task 3: Thêm quyền công bố tiến độ riêng cho CHT

**Files:**
- Create: lib/__tests__/dailyLogPublishProgressPermission.test.ts
- Create: supabase/migrations/20260923091500_daily_log_publish_progress_permission.sql
- Modify: lib/permissions/projectPermissionRooms.ts
- Modify: lib/permissions/projectRoomEffectiveActions.ts
- Modify: lib/permissions/projectPermissionRegistry.ts
- Modify: pages/project/DailyLogTab.tsx

**Interfaces:**
- Produces: Room action publish_progress và permission code project.daily_log.publish_progress.
- Consumes: Daily Log Room approve, current_actor_has_effective_room_action().

- [ ] **Step 1: Viết test fail cho registry và capability**

    expect(PROJECT_ROOM_ACTION_CODES).toContain('publish_progress');
    expect(getProjectPermissionRoom('daily_log')?.actions).toContain('publish_progress');
    expect(getDailyLogPermissionCodesForEffectiveRoomActions(['publish_progress']))
      .toEqual(['project.daily_log.publish_progress']);

- [ ] **Step 2: Chạy test để xác nhận fail**

Run: npm test -- lib/__tests__/dailyLogPublishProgressPermission.test.ts

Expected: FAIL vì action chưa tồn tại.

- [ ] **Step 3: Mở rộng registry TypeScript**

Thêm publish_progress vào PROJECT_ROOM_ACTION_CODES và Daily Log Room; map duy nhất:

    publish_progress: ['project.daily_log.publish_progress']

Không map approve sang publish_progress. UI chỉ hiện Duyệt & công bố khi actor có cả approve và publish_progress.

- [ ] **Step 4: Tạo migration permission catalog/binding**

Migration upsert permission_actions cho project.daily_log.publish_progress, risk_level sensitive, direct_grant_requires_expiry true; thêm action binding Daily Log Room ở trạng thái audit_only. Không backfill rộng; operation pilot sau Task 10 mới chuyển đúng scope/template.

- [ ] **Step 5: Chạy test registry và migration contract**

Run: npm test -- lib/__tests__/dailyLogPublishProgressPermission.test.ts lib/__tests__/projectRoomEffectiveActions.test.ts lib/__tests__/permissionRegistry.test.ts

Run: npm run lint

Expected: PASS.

- [ ] **Step 6: Commit**

    git add lib/permissions/projectPermissionRooms.ts lib/permissions/projectRoomEffectiveActions.ts lib/permissions/projectPermissionRegistry.ts pages/project/DailyLogTab.tsx lib/__tests__/dailyLogPublishProgressPermission.test.ts supabase/migrations/20260923091500_daily_log_publish_progress_permission.sql
    git commit -m "feat(daily-log): add progress publication capability"

---

### Task 4: Tạo bundle và command lưu phiếu nguồn/bản tổng hợp

**Files:**
- Create: supabase/migrations/20260923093000_daily_log_wbs_area_commands.sql
- Create: lib/dailyLogWbsService.ts
- Create: lib/__tests__/dailyLogWbsService.test.ts
- Create: lib/__tests__/dailyLogWbsCommandsMigration.test.ts
- Modify: lib/projectService.ts
- Modify: lib/dailyLogWorkflow.ts

**Interfaces:**
- Produces: get_daily_log_wbs_bundle_v1(), save_daily_log_contribution_work_v1(), save_daily_log_summary_work_v1(), request_daily_log_summary_source_changes_v1(), DailyLogWbsBundle, dailyLogWbsService.
- Consumes: types/rules Task 1, schema Task 2, Daily Log Room quyền Task 3.

- [ ] **Step 1: Viết service test fail**

    await dailyLogWbsService.saveContribution({
      contributionId: 'contribution-1',
      expectedRowVersion: 3,
      workAreaCode: 'A',
      workAreaName: 'Khu A',
      items: [{ clientKey: 'work-1', taskId: 'task-1', cumulativeProgressPercent: 35 }],
      labor: [{
        workItemClientKey: 'work-1',
        laborType: 'Tổ xây dựng',
        peopleCount: 5,
        hoursPerPerson: 8,
        provider: { entryMode: 'manual', manualProviderType: 'free_crew', manualProviderName: 'Tổ anh Minh' },
      }],
      machines: [],
    });

    expect(mockRpc).toHaveBeenCalledWith('save_daily_log_contribution_work_v1', expect.objectContaining({
      p_contribution_id: 'contribution-1',
      p_expected_row_version: 3,
      p_work_area_code: 'A',
    }));

Contract test SQL thêm hai case: manual provider thiếu tên trả `MANUAL_PROVIDER_NAME_REQUIRED`; payload labor có `unitCost` hoặc `totalCost` trả `RESOURCE_PRICE_FIELDS_NOT_ALLOWED` và không ghi bất kỳ dòng chi tiết nào.

- [ ] **Step 2: Chạy test để xác nhận fail**

Run: npm test -- lib/__tests__/dailyLogWbsService.test.ts lib/__tests__/dailyLogWbsCommandsMigration.test.ts

Expected: FAIL vì service/migration chưa tồn tại.

- [ ] **Step 3: Tạo read bundle**

Khóa contract TypeScript trước khi viết adapter:

    export interface DailyLogWbsBundle {
      rollout: { mode: 'off' | 'pilot' | 'enforced' | 'paused'; cutoverDate: string; enabled: boolean };
      tasks: ProjectTask[];
      workBoqItems: ProjectWorkBoqItem[];
      resourceProviders: BusinessPartner[];
      previousProgressRows: ProjectDailyTaskProgress[];
      nextProgressRows: ProjectDailyTaskProgress[];
      contribution: DailyLogContribution | null;
      contributionsForSummary: DailyLogContribution[];
      summaryLog: DailyLog | null;
      summarySources: DailyLogSummarySource[];
      workItems: DailyLogWorkItem[];
      decisions: DailyLogWbsDecision[];
      labor: DailyLogLabor[];
      machines: DailyLogMachine[];
      periodState: ProjectProgressPeriodState | null;
      permissions: { canEditSource: boolean; canSummarize: boolean; canApprove: boolean; canPublishProgress: boolean };
    }

    export interface DailyLogWorkSaveReceipt {
      rowVersion: number;
      updatedAt: string;
      sourceFingerprint: string;
      conflicts: Array<{ code: DailyLogWorkConflictCode; taskId?: string; summarySourceId?: string }>;
    }

    create function public.get_daily_log_wbs_bundle_v1(
      p_project_id text,
      p_construction_site_id text,
      p_log_date date,
      p_daily_log_id text default null
    ) returns jsonb

Bundle trả rollout, leafTasks, workBoqItems, resourceProviders active có classification supplier/contractor, previousProgressRows, nextProgressRows, contribution, contributionsForSummary, summaryLog, summarySources, workItems, decisions, labor, machines, periodState và permissions. Query theo tập id, không loop N+1; không select `unit_cost`/`total_cost` trong luồng mới.

- [ ] **Step 4: Tạo command lưu contribution**

    create function public.save_daily_log_contribution_work_v1(
      p_contribution_id uuid,
      p_expected_row_version bigint,
      p_work_area_code text,
      p_work_area_name text,
      p_items jsonb,
      p_labor jsonb,
      p_machines jsonb
    ) returns jsonb

Helper app_private khóa contribution FOR UPDATE, xác thực author/scope/status draft hoặc returned, rollout/date, leaf task và baseline fingerprint. Mỗi item có `clientKey`; labor/machine tham chiếu bằng `workItemClientKey`. Server xác thực provider mode, snapshot lại catalog provider active, tính total hours, ghi semantics version 2, buộc `unit_cost`/`total_cost = null`, tự tính cumulative/daily quantity; xóa-thêm chi tiết của đúng owner trong transaction và tăng row_version. JSON có trường price/amount ngoài contract bị reject bằng `RESOURCE_PRICE_FIELDS_NOT_ALLOWED`.

- [ ] **Step 5: Tạo command lưu summary snapshot**

    create function public.save_daily_log_summary_work_v1(
      p_daily_log_id text,
      p_expected_updated_at timestamptz,
      p_sources jsonb,
      p_items jsonb,
      p_decisions jsonb,
      p_labor jsonb,
      p_machines jsonb
    ) returns jsonb

Command chỉ nhận summary_source_type = member_contributions ở draft/rejected, kiểm tra summarize permission, unique contribution, source status/version và lưu snapshot. `p_decisions` phải có đúng một quyết định cho mỗi task được tổng hợp; manual override bắt buộc lý do. Server tính lại fingerprint của source rows, nguồn cung cấp và các giá trị quy đổi trước khi ghi; không sao chép giá legacy. Nếu card đã chỉnh và source mới hơn, giữ bản chỉnh trừ khi payload có refreshSource = true; trả conflicts theo card.

- [ ] **Step 6: Tạo command yêu cầu sửa riêng một card nguồn**

    create function public.request_daily_log_summary_source_changes_v1(
      p_daily_log_id text,
      p_summary_source_id uuid,
      p_comment text,
      p_expected_updated_at timestamptz
    ) returns jsonb

Command yêu cầu Daily Log approve, comment không rỗng, khóa summary/source `FOR UPDATE`, set `review_status = 'change_requested'`, ghi reviewer/time và đưa summary về `rejected` theo workflow hiện có. Snapshot và attribution của các card khác không thay đổi.

- [ ] **Step 7: Implement adapter TypeScript**

    export const dailyLogWbsService = {
      getBundle(input: DailyLogWbsBundleInput): Promise<DailyLogWbsBundle>,
      saveContribution(input: SaveDailyLogContributionWorkInput): Promise<DailyLogWorkSaveReceipt>,
      saveSummary(input: SaveDailyLogSummaryWorkInput): Promise<DailyLogWorkSaveReceipt>,
      requestSourceChange(input: RequestDailyLogSourceChangeInput): Promise<DailyLogWorkSaveReceipt>,
    };

DailyLogWbsBundleInput gồm projectId, constructionSiteId, logDate và dailyLogId tùy chọn. SaveDailyLogContributionWorkInput và SaveDailyLogSummaryWorkInput dùng đúng payload trong chữ ký RPC ở Step 4–5; không có thuộc tính price/cost/amount và không gửi total hours đã tính từ client như dữ liệu tin cậy.

Map snake/camel bằng dbMapping hiện có; map mã lỗi ROW_VERSION_CONFLICT, SOURCE_CHANGED, SOURCE_RETURNED, PERIOD_LOCKED thành copy tiếng Việt có hành động.

- [ ] **Step 8: Chạy unit, contract và Cloud smoke foundation**

Run: npm test -- lib/__tests__/dailyLogWbsService.test.ts lib/__tests__/dailyLogWbsCommandsMigration.test.ts

Run: npx --no-install supabase db query --linked --agent=no --file supabase/tests/daily_log_wbs_area_foundation_smoke.sql

Expected: PASS và smoke rollback sạch.

- [ ] **Step 9: Commit**

    git add supabase/migrations/20260923093000_daily_log_wbs_area_commands.sql lib/dailyLogWbsService.ts lib/projectService.ts lib/dailyLogWorkflow.ts lib/__tests__/dailyLogWbsService.test.ts lib/__tests__/dailyLogWbsCommandsMigration.test.ts supabase/tests/daily_log_wbs_area_foundation_smoke.sql
    git commit -m "feat(daily-log): add WBS area read and draft commands"

---

### Task 5: Xây editor phiếu nguồn theo WBS

**Files:**
- Create: components/project/daily-log/DailyLogWbsPicker.tsx
- Create: components/project/daily-log/DailyLogWorkItemTable.tsx
- Create: components/project/daily-log/DailyLogResourceEditor.tsx
- Create: components/project/daily-log/DailyLogContributionWorkEditor.tsx
- Create: lib/__tests__/dailyLogContributionWorkEditor.test.tsx
- Modify: pages/project/DailyLogTab.tsx
- Modify: components/project/DailyLogDetailTabs.tsx

**Interfaces:**
- Consumes: DailyLogWbsBundle, dailyLogWbsService.saveContribution(), deriveWorkItemProgress().
- Produces: phiếu nguồn mới sau cutover; legacy editor trước cutover vẫn hoạt động.

- [ ] **Step 1: Viết component test fail**

Test render bundle có parent và hai leaf tasks; chỉ leaf có checkbox. Sau khi chọn task:

    expect(screen.getByText('1.1 Bê tông móng')).toBeVisible();
    expect(screen.getByLabelText('% lũy kế')).toHaveValue(30);
    expect(screen.getByText('Khối lượng hôm nay: 20 m³')).toBeVisible();

Với plannedQuantity null:

    expect(screen.getByText('Chưa có cơ sở quy đổi')).toBeVisible();
    expect(screen.queryByText('0 m³')).not.toBeInTheDocument();

Với một dòng nhân công chưa chọn nguồn:

    expect(screen.getByText('Chọn NCC/đội hoặc nhập tay')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Lưu nháp' })).toBeDisabled();

Chọn `Nhập tay`, loại `Nhân công nhật`, nhập `Tổ anh Minh` rồi kiểm tra payload chỉ có số lượng/thời gian/provider và không có `unitCost`, `totalCost`, `rate` hoặc `amount`.

- [ ] **Step 2: Chạy test để xác nhận fail**

Run: npm test -- lib/__tests__/dailyLogContributionWorkEditor.test.tsx

Expected: FAIL vì components chưa tồn tại.

- [ ] **Step 3: Implement WBS picker**

Props công khai:

    interface DailyLogWbsPickerProps {
      tasks: ProjectTask[];
      workBoqItems: ProjectWorkBoqItem[];
      selectedTaskIds: ReadonlySet<string>;
      recentTaskIds: readonly string[];
      onConfirm(taskIds: string[]): void;
      onClose(): void;
    }

Search không dấu; filter planned_today, planned_week, active, recent, all. Parent chỉ expand/collapse; leaf mới có checkbox.

- [ ] **Step 4: Implement bảng và resource editor**

Desktop dùng sticky header/WBS; tablet horizontal scroll; mobile card accordion. Mỗi row hiển thị baseline, cumulative, daily delta, labor summary, machine summary, forecast. Resource editor nhập peopleCount × hoursPerPerson và machineCount × hoursPerMachine. Mỗi dòng có combobox `Nguồn cung cấp` lấy từ resourceProviders và lựa chọn cuối `Nhập tay`; mode nhập tay mở loại nguồn, tên bắt buộc và ghi chú tùy chọn. Không render hoặc giữ trong form state bất kỳ trường giá/tiền nào.

- [ ] **Step 5: Gắn vào DailyLogTab theo rollout/date**

Nếu bundle.rollout.enabled và log date >= cutoverDate, dùng DailyLogContributionWorkEditor. Nếu không, giữ DailyLogDetailTabs hiện tại. Xóa hành động “Lấy từ chốt tiến độ” chỉ trong luồng mới; không xóa legacy function ở task này.

- [ ] **Step 6: Kiểm tra trạng thái UX**

Test loading, empty WBS, denied, source returned, version conflict, missing planned quantity, catalog provider inactive, manual provider thiếu tên, submitted read-only và mobile 390 px. Primary actions là Lưu nháp và Gửi tổng hợp.

- [ ] **Step 7: Chạy test và typecheck**

Run: npm test -- lib/__tests__/dailyLogContributionWorkEditor.test.tsx lib/__tests__/dailyLogAssignmentUiContract.test.ts

Run: npm run lint

Expected: PASS.

- [ ] **Step 8: Commit**

    git add components/project/daily-log pages/project/DailyLogTab.tsx components/project/DailyLogDetailTabs.tsx lib/__tests__/dailyLogContributionWorkEditor.test.tsx
    git commit -m "feat(daily-log): add WBS contribution editor"

---

### Task 6: Xây workspace tổng hợp và chế độ duyệt CHT

**Files:**
- Create: components/project/daily-log/DailyLogAreaCard.tsx
- Create: components/project/daily-log/DailyLogSummaryWorkspace.tsx
- Create: components/project/daily-log/DailyLogConsolidatedWbsTable.tsx
- Create: components/project/daily-log/DailyLogSourceDiff.tsx
- Create: lib/__tests__/dailyLogSummaryWorkspace.test.tsx
- Modify: pages/project/DailyLogTab.tsx
- Modify: lib/dailyLogWorkflow.ts
- Modify: lib/__tests__/dailyLogWorkflow.test.ts

**Interfaces:**
- Consumes: dailyLogWbsService.saveSummary(), aggregateAreaWorkItems(), existing summary/return workflow.
- Produces: card 2 × 2 desktop, accordion mobile, official WBS decisions, per-card change request.

- [ ] **Step 1: Viết test fail cho bốn card và overview**

    render(<DailyLogSummaryWorkspace bundle={bundleWithFourSources} mode="summarize" />);
    expect(screen.getAllByTestId('daily-log-area-card')).toHaveLength(4);
    expect(screen.getByText('4 khu vực')).toBeVisible();
    expect(screen.getByText('68 người')).toBeVisible();
    expect(screen.getByText('2 cảnh báo')).toBeVisible();

Test source changed giữ edited value và hiện nút Cập nhật từ phiếu. Test same task without allocation disables Gửi CHT until official cumulative is entered.

Thêm case source missing/returned: card vẫn hiện snapshot và attribution, nhưng Gửi CHT bị khóa cho tới khi bỏ card hoặc nguồn hợp lệ trở lại.

Thêm case một dòng dùng NCC danh mục và một dòng nhập tay: card hiển thị đúng badge `Danh mục`/`Nhập tay`, tổng số người/giờ nhưng không có nhãn đơn giá, thành tiền hoặc định giá.

- [ ] **Step 2: Chạy test để xác nhận fail**

Run: npm test -- lib/__tests__/dailyLogSummaryWorkspace.test.tsx

Expected: FAIL vì workspace chưa tồn tại.

- [ ] **Step 3: Implement card và diff**

DailyLogAreaCard header luôn có workAreaName, sourceUserName, sourceState, updatedAt, số WBS/nhân công/giờ máy và badge Đã điều chỉnh. Dòng resource luôn hiển thị providerNameSnapshot hoặc manualProviderName cùng loại nguồn. DailyLogSourceDiff so sánh sourceSnapshot với normalized edited rows và chỉ hiển thị trường thay đổi, gồm cả thay đổi nguồn cung cấp.

- [ ] **Step 4: Implement overview và bảng WBS**

DailyLogConsolidatedWbsTable nhóm theo taskId, có row con theo summarySourceId. Với missing_area_allocation, render input officialCumulativePercent và lý do; không hiển thị giá trị tự suy diễn. Khi nghi ngờ phạm vi trùng, bắt người tổng hợp chọn `Cộng các phạm vi không trùng`, `Chỉ giữ nguồn đã chọn` hoặc `Nhập giá trị chính thức`, rồi lưu danh sách source được dùng và lý do vào `daily_log_wbs_decisions`. Xung đột forecast cũng bắt chốt một ngày và lý do. Mọi quyết định hợp lệ được lưu vào database, không chỉ giữ trong component state. Tổng người/giờ chỉ lấy bản sao hiện tại, không cộng thêm source gốc.

- [ ] **Step 5: Implement review mode**

Mode review là read-only dữ liệu nghiệp vụ, có:

- Duyệt & công bố nếu có approve + publish_progress.
- Trả lại toàn bộ.
- Yêu cầu sửa khu vực, bắt buộc comment và set review_status = change_requested.
- Xem bản nguồn/bản chỉnh.

- [ ] **Step 6: Gắn workspace vào summary modal hiện tại**

Thay khối tổng hợp text đơn bằng workspace mới sau cutover; giữ weather, description, issues, nextDayPlan và photos ở phần tổng quan. Legacy modal trước cutover không đổi.

- [ ] **Step 7: Chạy test và visual walkthrough**

Run: npm test -- lib/__tests__/dailyLogSummaryWorkspace.test.tsx lib/__tests__/dailyLogWorkflow.test.ts

Run: npm run lint

Khởi động Vite và kiểm tra desktop 1440 px, tablet 900 px, mobile 390 px; không có 4 card ép thành 4 cột.

- [ ] **Step 8: Commit**

    git add components/project/daily-log pages/project/DailyLogTab.tsx lib/dailyLogWorkflow.ts lib/__tests__/dailyLogSummaryWorkspace.test.tsx lib/__tests__/dailyLogWorkflow.test.ts
    git commit -m "feat(daily-log): add area summary workspace"

---

### Task 7: Công bố tiến độ atomic, idempotent khi CHT duyệt

**Files:**
- Create: supabase/migrations/20260923100000_daily_log_summary_progress_publication.sql
- Create: supabase/tests/daily_log_summary_progress_publication_smoke.sql
- Create: lib/__tests__/dailyLogProgressPublicationMigration.test.ts
- Modify: lib/dailyLogWbsService.ts
- Modify: pages/project/DailyLogTab.tsx

**Interfaces:**
- Produces: submit_daily_log_summary_v1(), publish_daily_log_summary_v1(), dailyLogWbsService.submitSummary(), publishSummary().
- Consumes: app_private.write_project_progress_period_payload(), progress period locks, publish_progress permission.

- [ ] **Step 1: Viết contract test fail**

    expect(sql).toContain('create table public.daily_log_publish_commands');
    expect(sql).toContain('publish_daily_log_summary_v1');
    expect(sql).toContain("summary_source_type = 'member_contributions'");
    expect(sql).toContain("'publish_progress'");
    expect(sql).toContain('for update');
    expect(sql).toContain('source_daily_log_id');
    expect(sql).toContain('on conflict (command_id)');

- [ ] **Step 2: Chạy test để xác nhận fail**

Run: npm test -- lib/__tests__/dailyLogProgressPublicationMigration.test.ts

Expected: FAIL vì migration chưa tồn tại.

- [ ] **Step 3: Tạo submit command**

    create function public.submit_daily_log_summary_v1(
      p_daily_log_id text,
      p_expected_updated_at timestamptz,
      p_approver_user_id uuid,
      p_submission_note text default null
    ) returns jsonb

Command kiểm tra summary, sources, conflicts, forecast reason, actor summarize/submit và approver Daily Log approve. Mỗi resource line phải có semantics version 2 và provider hợp lệ; catalog provider đã inactive hoặc manual provider thiếu type/name chặn submit. Sau đó command dùng workflow transition hiện có trong cùng transaction.

- [ ] **Step 4: Tạo publish command và receipt**

    create table public.daily_log_publish_commands (
      command_id uuid primary key,
      daily_log_id text not null references public.daily_logs(id),
      actor_user_id uuid not null references public.users(id),
      result jsonb,
      created_at timestamptz not null default now(),
      unique (daily_log_id)
    );

    create function public.publish_daily_log_summary_v1(
      p_daily_log_id text,
      p_expected_updated_at timestamptz,
      p_command_id uuid
    ) returns jsonb

Receipt TypeScript:

    export interface DailyLogPublishReceipt {
      commandId: string;
      dailyLogId: string;
      progressDate: string;
      publishedTaskIds: string[];
      verifiedResourceLineIds: string[];
      progressFingerprint: string;
      resourceEvidenceFingerprint: string;
      publishedAt: string;
    }

Helper khóa command/log/source/progress state. Server xác thực lại từng `daily_log_wbs_decisions`, resource provider snapshot và baseline; chặn locked period/backdated violation; tạo đúng một row mỗi task/day từ quyết định chính thức với source_daily_log_id = summary id; gọi helper progress rollup hiện có; cập nhật task actual dates; chuyển log verified và contribution included. Receipt liệt kê resource line đã trở thành bằng chứng đang hiệu lực. Command không đọc price book, không ghi `unit_cost`/`total_cost`, accrual hoặc `project_transactions`. Phiếu nguồn không được gọi command.

- [ ] **Step 5: Thêm idempotency/concurrency smoke**

Trong một transaction:

- gọi command hai lần cùng command_id và so sánh receipt;
- gọi lại với command_id khác cho cùng daily_log_id và nhận existing receipt, không tạo row mới;
- kiểm tra count progress theo task/day = 1;
- khóa tuần rồi xác nhận command rollback cả status và progress;
- đổi baseline fingerprint rồi xác nhận lỗi STALE_PROGRESS_BASELINE.
- đổi forecast nhưng bỏ trống forecast_change_reason rồi xác nhận command rollback.
- khóa catalog provider sau khi draft rồi xác nhận submit/publish bị chặn; manual provider hợp lệ vẫn publish được.
- gửi payload chứa price/cost/amount rồi xác nhận reject và `unit_cost`/`total_cost` của dòng mới vẫn null.
- kiểm tra count `project_transactions` không đổi và không có bảng/command accrual nào được gọi.
- yêu cầu sửa một card rồi xác nhận đúng card có `change_requested`, summary về `rejected`, các snapshot khác không đổi.

- [ ] **Step 6: Gắn service/UI**

    publishSummary(input: {
      dailyLogId: string;
      expectedUpdatedAt: string;
      commandId: string;
    }): Promise<DailyLogPublishReceipt>

Nút CHT gọi duy nhất publishSummary, không gọi updateStatus('verified') trước/sau. Retry giữ commandId trong state cho đến khi nhận receipt.

- [ ] **Step 7: Chạy contract, unit và Cloud smoke**

Run: npm test -- lib/__tests__/dailyLogProgressPublicationMigration.test.ts lib/__tests__/dailyLogWbsService.test.ts

Run: npx --no-install supabase db query --linked --agent=no --file supabase/tests/daily_log_summary_progress_publication_smoke.sql

Expected: PASS; smoke rollback sạch.

- [ ] **Step 8: Commit**

    git add supabase/migrations/20260923100000_daily_log_summary_progress_publication.sql supabase/tests/daily_log_summary_progress_publication_smoke.sql lib/__tests__/dailyLogProgressPublicationMigration.test.ts lib/dailyLogWbsService.ts pages/project/DailyLogTab.tsx
    git commit -m "feat(daily-log): publish summary progress atomically"

---

### Task 8: Chuyển tab Chốt tiến độ ngày sang read-only sau cutover

**Files:**
- Create: supabase/migrations/20260923101500_daily_progress_exception_command.sql
- Create: lib/__tests__/dailyProgressExceptionMigration.test.ts
- Create: lib/__tests__/weeklyProgressDailyLogCutover.test.tsx
- Modify: supabase/tests/daily_log_summary_progress_publication_smoke.sql
- Modify: pages/project/WeeklyProgressTab.tsx
- Modify: lib/projectWeeklyProgressService.ts
- Modify: types.ts

**Interfaces:**
- Consumes: rollout cutover, ProjectDailyTaskProgress.sourceDailyLogId.
- Produces: save_daily_progress_exception_v1(), read-only source badge/link cho ngày mới; legacy/manual edit cho ngày cũ và audited exception path.

- [ ] **Step 1: Viết test fail**

Với period sau cutover và row có sourceDailyLogId:

    expect(screen.getByText('Nguồn: Nhật ký tổng hợp')).toBeVisible();
    expect(screen.queryByRole('spinbutton', { name: '% hoàn thành' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Mở nhật ký' })).toHaveAttribute('href', expect.stringContaining('dailyLogId=summary-1'));

Với ngày trước cutover, editor hiện tại vẫn render.

- [ ] **Step 2: Chạy test để xác nhận fail**

Run: npm test -- lib/__tests__/weeklyProgressDailyLogCutover.test.tsx

Expected: FAIL.

- [ ] **Step 3: Viết migration contract và command ngoại lệ**

Contract test yêu cầu migration chứa `save_daily_progress_exception_v1`, `daily_progress_exception_audit`, `publish_progress`, `for update` và reason bắt buộc. Command chỉ cho actor có cả Weekly Progress edit và Daily Log publish_progress; khóa kỳ/progress row, xác thực previous/next baseline, ghi before/after JSON và lý do vào audit. Không dùng command này trong luồng nhật ký bình thường.

- [ ] **Step 4: Implement source presentation và edit guard**

Daily mode sau cutover chỉ đọc. Nút lưu period không gửi các row nguồn nhật ký. Exception manual mở drawer riêng, yêu cầu lý do và gọi duy nhất `save_daily_progress_exception_v1`; actor thiếu một trong hai quyền chỉ thấy hướng dẫn liên hệ người phụ trách.

- [ ] **Step 5: Gỡ chiều import ngược trong luồng mới**

DailyLogTab không render onImportDailyProgressVolumes sau cutover. Giữ lib/dailyLogProgressImport.ts và test legacy đến khi rollout toàn bộ hoàn tất.

- [ ] **Step 6: Chạy test**

Run: npm test -- lib/__tests__/dailyProgressExceptionMigration.test.ts lib/__tests__/weeklyProgressDailyLogCutover.test.tsx lib/__tests__/dailyLogProgressImport.test.ts lib/__tests__/weeklyProgressProtectedWrites.contract.test.ts

Run: npx --no-install supabase db query --linked --agent=no --file supabase/tests/daily_log_summary_progress_publication_smoke.sql

Run: npm run lint

Expected: PASS; smoke chứng minh actor thiếu một quyền bị deny, reason rỗng bị reject, period locked rollback và audit before/after được ghi trong transaction rồi rollback.

- [ ] **Step 7: Commit**

    git add supabase/migrations/20260923101500_daily_progress_exception_command.sql supabase/tests/daily_log_summary_progress_publication_smoke.sql lib/__tests__/dailyProgressExceptionMigration.test.ts pages/project/WeeklyProgressTab.tsx lib/projectWeeklyProgressService.ts types.ts lib/__tests__/weeklyProgressDailyLogCutover.test.tsx
    git commit -m "feat(progress): show daily log progress as authoritative"

---

### Task 9: Bổ sung revision cho bản tổng hợp đã xác nhận

**Files:**
- Create: supabase/migrations/20260923103000_daily_log_summary_revisions.sql
- Create: lib/__tests__/dailyLogSummaryRevisionMigration.test.ts
- Modify: lib/dailyLogWbsService.ts
- Modify: pages/project/DailyLogTab.tsx
- Modify: lib/dailyLogWorkflow.ts

**Interfaces:**
- Produces: create_daily_log_summary_revision_v1(), revisionNo, supersedesDailyLogId, supersededByDailyLogId.
- Consumes: period reopen hiện có và publish command Task 7.

- [ ] **Step 1: Viết contract test fail**

    expect(sql).toContain('supersedes_daily_log_id');
    expect(sql).toContain('superseded_by_daily_log_id');
    expect(sql).toContain('revision_reason');
    expect(sql).toContain('create_daily_log_summary_revision_v1');
    expect(sql).not.toContain('delete from public.project_daily_task_progress');

- [ ] **Step 2: Chạy test để xác nhận fail**

Run: npm test -- lib/__tests__/dailyLogSummaryRevisionMigration.test.ts

Expected: FAIL.

- [ ] **Step 3: Implement revision command**

Command chỉ nhận verified member_contributions, yêu cầu reason và quyền approve/publish_progress. Nếu period locked, trả PERIOD_LOCKED_WITH_REOPEN_REQUIRED. Command tạo draft revision, copy summary sources/work items/resource provider snapshots, liên kết hai chiều và không thay đổi progress hoặc bằng chứng đang hiệu lực cho đến lần publish revision.

- [ ] **Step 4: Mở rộng publish cho revision**

Khi publish revision, khóa chuỗi log và progress ngày liền trước/sau; thay source_daily_log_id sang revision, tính lại daily delta về sau nhưng giữ cumulative đã xác nhận. Resource lines của log cũ chuyển sang evidence superseded qua lineage của log; revision mới là evidence đang hiệu lực. Không xóa hoặc sửa snapshot provider cũ.

- [ ] **Step 5: Implement UI revision**

Verified view có “Tạo bản điều chỉnh”; bắt buộc lý do. Superseded view hiện revision mới. Nếu khóa kỳ, hiển thị link/hướng dẫn mở chốt thay vì mở form chỉnh.

- [ ] **Step 6: Chạy test và Cloud smoke mở chốt/backdate**

Run: npm test -- lib/__tests__/dailyLogSummaryRevisionMigration.test.ts lib/__tests__/dailyLogWorkflow.test.ts

Run: npx --no-install supabase db query --linked --agent=no --file supabase/tests/daily_log_summary_progress_publication_smoke.sql

Expected: PASS.

- [ ] **Step 7: Commit**

    git add supabase/migrations/20260923103000_daily_log_summary_revisions.sql lib/__tests__/dailyLogSummaryRevisionMigration.test.ts lib/dailyLogWbsService.ts pages/project/DailyLogTab.tsx lib/dailyLogWorkflow.ts
    git commit -m "feat(daily-log): add audited summary revisions"

---

### Task 10: Compatibility, E2E, pilot operation và tài liệu

**Files:**
- Create: tests/e2e/daily-log-wbs-area-summary.spec.ts
- Create: supabase/operations/daily_log_wbs_area_pilot.sql
- Create: lib/__tests__/dailyLogWbsLegacyCompatibility.test.ts
- Modify: lib/dailyLogSummaryService.ts
- Modify: lib/dailyLogDetailService.ts
- Modify: docs/runbooks/erp-completion-pilot-rollout.md
- Modify: docs/designs/erp-completion-2026-09-19/progress.md

**Interfaces:**
- Consumes: toàn bộ Task 1–9.
- Produces: compatibility projection, pilot enable/rollback operation, acceptance evidence.

- [ ] **Step 1: Viết compatibility test fail**

Test verified summary mới chỉ được đếm một lần; legacy summary vẫn đọc daily_log_volumes; contribution nguồn không lọt vào báo cáo official; missing source giữ snapshot.

    expect(result.filteredLogs.map(row => row.id)).toEqual(['summary-new', 'summary-legacy']);
    expect(result.overview.unresolvedLegacySummaryCount).toBe(1);
    expect(result.periods[0].volumes).not.toContainEqual(expect.objectContaining({ key: 'source-only' }));

- [ ] **Step 2: Chạy test để xác nhận fail**

Run: npm test -- lib/__tests__/dailyLogWbsLegacyCompatibility.test.ts

Expected: FAIL cho projection mới.

- [ ] **Step 3: Implement compatibility read**

dailyLogDetailService đọc daily_log_work_items trước cho log mới; nếu không có thì dùng daily_log_volumes. dailyLogSummaryService chỉ tổng hợp verified official log, không cộng contributions hoặc nguồn legacy đã được linked.

- [ ] **Step 4: Viết Playwright journey**

Journey gồm:

1. Người A tạo phiếu Khu A với WBS, 30%, 5 người và chọn NCC danh mục.
2. Người B tạo phiếu Khu B cùng WBS thiếu area allocation, khai báo 2 máy bằng nguồn nhập tay `Chủ máy anh Bình`.
3. Người tổng hợp chọn hai phiếu, thấy hai card và blocker.
4. Người tổng hợp chốt official cumulative + reason, gửi CHT.
5. CHT xem overview/diff, duyệt & công bố.
6. Tab tiến độ hiển thị một row nguồn Nhật ký tổng hợp; detail verified hiển thị hai provider snapshot và không có giá/tiền.
7. Mobile viewport 390 px hiển thị card theo accordion.

- [ ] **Step 5: Tạo operation pilot fail-closed**

Operation nhận project/site, cutover date, release id, owner, reason; kiểm tra Room recipients trước khi set mode pilot. Mode pilot ghi shadow result để so kết quả Nhật ký với tiến độ ngày hiện hành nhưng chưa tắt đường nhập cũ. Chỉ chuyển `enforced` và áp dụng read-only cutover sau khi báo cáo shadow không còn sai khác chưa giải thích. Rollback đặt paused hoặc off, không xóa dữ liệu. Không hardcode project/user production.

- [ ] **Step 6: Chạy full verification**

Run: npm test

Run: npm run lint

Run: npm run build

Run: npm run check:supabase-migrations

Run: npx playwright test tests/e2e/daily-log-wbs-area-summary.spec.ts

Run: npx --no-install supabase db query --linked --agent=no --file supabase/tests/daily_log_wbs_area_foundation_smoke.sql

Run: npx --no-install supabase db query --linked --agent=no --file supabase/tests/daily_log_summary_progress_publication_smoke.sql

Expected: tất cả PASS.

- [ ] **Step 7: Walkthrough nghiệp vụ pilot**

Kiểm tra bằng năm persona thật: người lập, người tổng hợp, CHT, QS/thanh toán chỉ đọc, người bị từ chối. Ghi bằng chứng desktop/tablet/mobile, catalog/manual provider, command receipt, progress/resource lineage, denied action, báo cáo shadow compare và rollback. Chỉ chuyển mode enforced sau khi không có duplicate progress/evidence, không còn sai khác shadow chưa giải thích và mọi card truy ngược được nguồn.

- [ ] **Step 8: Cập nhật tài liệu**

Runbook ghi enable, pause, rollback, source conflict, locked period và support owner. Progress doc ghi migration ids, test commands, evidence paths và mốc cutover.

- [ ] **Step 9: Commit**

    git add tests/e2e/daily-log-wbs-area-summary.spec.ts supabase/operations/daily_log_wbs_area_pilot.sql lib/__tests__/dailyLogWbsLegacyCompatibility.test.ts lib/dailyLogSummaryService.ts lib/dailyLogDetailService.ts docs/runbooks/erp-completion-pilot-rollout.md docs/designs/erp-completion-2026-09-19/progress.md
    git commit -m "test(daily-log): complete WBS area summary pilot"

---

## Completion Gate

Plan 1 hoàn thành khi:

- Phiếu nguồn mới bắt buộc người + khu vực + WBS và không tự ghi progress.
- Mỗi labor/machine line mới có provider catalog hoặc manual hợp lệ; không có giá/tiền.
- Người tổng hợp chỉnh được từng card, thấy diff/conflict và gửi một bản ngày.
- CHT duyệt bằng command atomic/idempotent và tab tiến độ hiển thị lineage về summary/card/source.
- Legacy trước cutover vẫn đọc được, không có backfill đoán dữ liệu.
- Unit, contract, Cloud smoke, E2E, typecheck và build đều pass.
- Pilot có bằng chứng bốn persona, desktop/tablet/mobile và rollback đã diễn tập.

Chỉ sau gate này mới thực hiện plan báo cáo bằng chứng nguồn lực:

docs/superpowers/plans/2026-09-23-daily-log-resource-evidence-supplier-payment-readiness.md
