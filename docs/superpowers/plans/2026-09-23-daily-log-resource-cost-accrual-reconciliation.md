# Daily Log Resource Cost Accrual and Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Biến nhân công và giờ máy đã được CHT xác nhận thành tiêu hao theo WBS, chi phí tạm tính có nguồn đơn giá rõ ràng và đối soát được với giao dịch thực tế mà không ghi trùng actual cost.

**Architecture:** Dùng bảng binding để nối catalog nguồn lực với internal_price_book và snapshot rate/unit/standard hours khi publish summary. project_resource_cost_accruals là sổ chi phí tạm tính, project_transactions vẫn là nguồn actual duy nhất; bảng match phân bổ actual vào accrual theo command có kiểm soát và báo cáo luôn tách Estimated/Actual/Unmatched.

**Tech Stack:** React 18, TypeScript 5.8, Vite 6, Vitest 4, Supabase/PostgreSQL/RLS/RPC, Tailwind utility classes, lucide-react.

**Spec:** docs/superpowers/specs/2026-09-23-daily-log-wbs-progress-resources-cost-design.md

**Prerequisite:** docs/superpowers/plans/2026-09-23-daily-log-wbs-area-summary-progress.md đã qua Completion Gate.

## Global Constraints

- Thực thi bằng agent chính với superpowers:executing-plans; AGENTS.md cấm sub-agent.
- Mọi thao tác Supabase dùng Supabase Cloud từ cấu hình .env; không dùng Supabase local hoặc Docker.
- Không tạo project_transactions từ nhật ký; actual cost chỉ đến từ chứng từ/giao dịch tài chính hiện hành.
- Accrual chỉ sinh từ bản tổng hợp member_contributions đã được CHT xác nhận; contribution nguồn không sinh accrual.
- Người hiện trường không nhập đơn giá và không nhận rate/amount trong payload nếu thiếu quyền tài chính.
- Rate unit phải là labor_hour, person_day, machine_hour hoặc shift; không suy diễn từ chuỗi đơn vị legacy.
- Không mặc định ngầm 8 giờ; standard hours luôn đến từ binding và được snapshot.
- Thiếu rate tạo unpriced accrual, không tạo estimated_amount = 0.
- Revision void accrual cũ và tạo accrual mới; không sửa mất lịch sử.
- Báo cáo Estimated, Actual, Unmatched và Variance là bốn đại lượng riêng.
- Giữ Design System hiện tại; không thêm thư viện UI mới.
- Dùng TDD, command atomic/idempotent và commit riêng sau mỗi task.

## Review Focus

1. Unit price tồn tại nhưng unit không tương thích với resource type: accrual phải unpriced và ghi pricing error, không nhân sai — Task 1, 3.
2. Legacy hours không rõ là giờ/người hay tổng giờ: không tái diễn giải và không định giá tự động — Task 1, 3.
3. Người không có view_cost gọi read RPC: chỉ thấy priced/unpriced status, không thấy rate hoặc amount — Task 2, 5.
4. Một project transaction được match nhiều accrual hoặc partial match: tổng matched không vượt actual amount và retry không tạo trùng — Task 6.
5. Summary revision/supersede: accrual cũ void, match cũ được giữ audit/đảo phân bổ theo rule, actual transaction không bị nhân đôi — Task 3, 6.

## File Map

**Tạo mới:**

- lib/resourceCostAccrualRules.ts: chuẩn hóa usage/rate và tính estimated cost.
- lib/projectResourceCostService.ts: adapter rate binding, accrual overview và reconciliation RPC.
- components/project/daily-log/ResourcePricingStatus.tsx: trạng thái định giá không lộ số tiền.
- components/project/finance/ResourceRateBindingPanel.tsx: cấu hình nguồn đơn giá.
- components/project/finance/ResourceCostAccrualPanel.tsx: bảng Estimated/Actual/Unmatched theo WBS.
- components/project/finance/ResourceCostReconciliationDrawer.tsx: phân bổ transaction vào accrual.
- supabase/migrations/20260923110000_resource_cost_accrual_foundation.sql.
- supabase/migrations/20260923111500_resource_rate_binding_commands.sql.
- supabase/migrations/20260923113000_resource_cost_pricing_publication.sql.
- supabase/migrations/20260923120000_resource_cost_reconciliation.sql.
- supabase/tests/resource_cost_permission_boundary_smoke.sql.
- supabase/tests/resource_cost_accrual_smoke.sql.
- supabase/tests/resource_cost_reconciliation_smoke.sql.
- Các unit/contract test nêu trong từng task.

**Sửa chính:**

- types.ts, lib/supabaseProjections.ts.
- lib/permissions/projectPermissionRooms.ts, lib/permissions/projectRoomEffectiveActions.ts, lib/permissions/projectPermissionRegistry.ts.
- lib/dailyLogWbsService.ts và migration publish summary từ Plan 1 bằng migration mới, không sửa migration đã chạy.
- pages/project/DailyLogTab.tsx.
- lib/projectCostItemService.ts, components/project/CostAnalysisPanel.tsx, pages/project/ProjectFinanceWorkspace.tsx.
- docs/runbooks/erp-completion-pilot-rollout.md và progress/evidence docs.

---

### Task 1: Khóa semantics giờ công, giờ máy và công thức chi phí

**Files:**
- Create: lib/resourceCostAccrualRules.ts
- Create: lib/__tests__/resourceCostAccrualRules.test.ts
- Modify: types.ts

**Interfaces:**
- Produces: ResourceRateUnit, ResourcePricingStatus, ResourceUsageSnapshot, calculateLaborUsage(), calculateMachineUsage(), calculateEstimatedCost().
- Consumes: peopleCount/hoursPerPerson, machineCount/hoursPerMachine và explicit rate binding.

- [ ] **Step 1: Viết unit test fail**

    import { describe, expect, it } from 'vitest';
    import {
      calculateEstimatedCost,
      calculateLaborUsage,
      calculateMachineUsage,
    } from '../resourceCostAccrualRules';

    it('calculates labor hours and person-day cost from configured hours', () => {
      const usage = calculateLaborUsage({ peopleCount: 5, hoursPerPerson: 6 });
      expect(usage.totalHours).toBe(30);
      expect(calculateEstimatedCost({
        resourceType: 'labor',
        totalHours: 30,
        rateUnit: 'person_day',
        rateAmount: 800000,
        standardHours: 8,
      })).toEqual({ pricingStatus: 'estimated', usageQuantity: 3.75, estimatedAmount: 3000000 });
    });

    it('does not assume standard hours', () => {
      expect(calculateEstimatedCost({
        resourceType: 'machine',
        totalHours: 10,
        rateUnit: 'shift',
        rateAmount: 2000000,
        standardHours: null,
      })).toMatchObject({ pricingStatus: 'unpriced', estimatedAmount: null, errorCode: 'missing_standard_hours' });
    });

    it('rejects an incompatible rate unit', () => {
      expect(calculateEstimatedCost({
        resourceType: 'labor',
        totalHours: 8,
        rateUnit: 'shift',
        rateAmount: 1000000,
        standardHours: 8,
      })).toMatchObject({ pricingStatus: 'unpriced', errorCode: 'incompatible_rate_unit' });
    });

    it('does not reinterpret an ambiguous legacy hours value', () => {
      expect(calculateLaborUsage({
        peopleCount: 5,
        hoursPerPerson: null,
        legacyHours: 30,
      })).toMatchObject({ totalHours: null, errorCode: 'ambiguous_legacy_hours' });
    });

- [ ] **Step 2: Chạy test để xác nhận fail**

Run: npm test -- lib/__tests__/resourceCostAccrualRules.test.ts

Expected: FAIL vì module/types chưa tồn tại.

- [ ] **Step 3: Thêm types**

    export type ResourceType = 'labor' | 'machine';
    export type ResourceRateUnit = 'labor_hour' | 'person_day' | 'machine_hour' | 'shift';
    export type ResourcePricingStatus = 'unpriced' | 'estimated' | 'partially_matched' | 'matched' | 'void';

    export interface ResourceUsageSnapshot {
      totalHours: number | null;
      usageQuantity?: number | null;
      usageUnit?: ResourceRateUnit | null;
      errorCode?: 'ambiguous_legacy_hours' | 'missing_standard_hours' | 'incompatible_rate_unit' | null;
    }

    export interface ProjectResourceRateBinding {
      id: string;
      projectId?: string | null;
      constructionSiteId?: string | null;
      resourceType: ResourceType;
      catalogItemId: string;
      priceBookItemId: string;
      rateUnit: ResourceRateUnit;
      standardHours?: number | null;
      effectiveFrom: string;
      effectiveTo?: string | null;
      isActive: boolean;
      updatedAt: string;
    }

    export interface ResourceCostScopeInput {
      projectId: string;
      constructionSiteId?: string | null;
      effectiveOn?: string;
    }

    export interface SaveProjectResourceRateBindingInput extends ResourceCostScopeInput {
      id?: string;
      resourceType: ResourceType;
      catalogItemId: string;
      priceBookItemId: string;
      rateUnit: ResourceRateUnit;
      standardHours?: number | null;
      effectiveFrom: string;
      effectiveTo?: string | null;
      expectedUpdatedAt?: string | null;
    }

    export interface ProjectResourceCostAccrual {
      id: string;
      projectId?: string | null;
      constructionSiteId?: string | null;
      taskId: string;
      workItemId: string;
      sourceDailyLogId: string;
      sourceLineId: string;
      resourceType: ResourceType;
      costItemCode: 'I.2' | 'I.3';
      usageQuantity: number;
      usageUnit: ResourceRateUnit;
      rateAmount?: number | null;
      rateUnit?: ResourceRateUnit | null;
      rateSourceType?: 'internal_price_book' | null;
      estimatedAmount?: number | null;
      matchedActualAmount: number;
      varianceAmount?: number | null;
      pricingStatus: ResourcePricingStatus;
      reconciliationStatus: 'unmatched' | 'partially_matched' | 'matched' | 'void';
      pricingErrorCode?: string | null;
    }

    export interface ResourceCostOverview {
      estimatedAmount: number;
      actualAmount: number;
      matchedAmount: number;
      unmatchedEstimatedAmount: number;
      varianceAmount: number;
      unpricedCount: number;
      rows: ProjectResourceCostAccrual[];
    }

    export interface ResourceCostReconciliationReceipt {
      commandId: string;
      matchId: string;
      accrualId: string;
      projectTransactionId: string;
      matchedAmount: number;
      accrualMatchedAmount: number;
      transactionRemainingAmount: number;
      status: 'partially_matched' | 'matched';
    }

- [ ] **Step 4: Implement pure rules**

    export const calculateLaborUsage = (input: {
      peopleCount: number;
      hoursPerPerson: number | null;
      legacyHours?: number | null;
    }): ResourceUsageSnapshot => input.hoursPerPerson == null
      ? { totalHours: null, errorCode: 'ambiguous_legacy_hours' }
      : { totalHours: input.peopleCount * input.hoursPerPerson, errorCode: null };

    export const calculateMachineUsage = (input: { machineCount: number; hoursPerMachine: number }) => ({
      totalHours: input.machineCount * input.hoursPerMachine,
    });

calculateEstimatedCost() chỉ chấp nhận labor_hour/person_day cho labor và machine_hour/shift cho machine. Với day/shift, standardHours phải dương. Kết quả tiền làm tròn 2 chữ số; usage giữ 4 chữ số.

- [ ] **Step 5: Chạy test và typecheck**

Run: npm test -- lib/__tests__/resourceCostAccrualRules.test.ts

Run: npm run lint

Expected: PASS.

- [ ] **Step 6: Commit**

    git add types.ts lib/resourceCostAccrualRules.ts lib/__tests__/resourceCostAccrualRules.test.ts
    git commit -m "feat(cost): define resource accrual calculations"

---

### Task 2: Tạo schema rate binding, accrual và quyền tài chính

**Files:**
- Create: supabase/migrations/20260923110000_resource_cost_accrual_foundation.sql
- Create: supabase/tests/resource_cost_permission_boundary_smoke.sql
- Create: lib/__tests__/resourceCostAccrualFoundationMigration.test.ts
- Modify: lib/permissions/projectPermissionRooms.ts
- Modify: lib/permissions/projectRoomEffectiveActions.ts
- Modify: lib/permissions/projectPermissionRegistry.ts
- Modify: lib/supabaseProjections.ts

**Interfaces:**
- Consumes: internal_price_book, daily_log_work_items, daily_log_labor, daily_log_machines, project_transactions.
- Produces: project_resource_rate_bindings, project_resource_cost_accruals, payment Room actions view_cost/reconcile_cost.

- [ ] **Step 1: Viết migration/permission contract test fail**

    expect(sql).toContain('create table public.project_resource_rate_bindings');
    expect(sql).toContain('create table public.project_resource_cost_accruals');
    expect(sql).toContain('estimated_amount numeric');
    expect(sql).toContain('cost_item_code_snapshot text');
    expect(sql).toContain('matched_actual_amount numeric');
    expect(sql).toContain('pricing_status');
    expect(sql).toContain('enable row level security');
    expect(PROJECT_ROOM_ACTION_CODES).toEqual(expect.arrayContaining(['view_cost', 'reconcile_cost']));

- [ ] **Step 2: Chạy test để xác nhận fail**

Run: npm test -- lib/__tests__/resourceCostAccrualFoundationMigration.test.ts

Expected: FAIL.

- [ ] **Step 3: Tạo rate binding**

    create table public.project_resource_rate_bindings (
      id uuid primary key default gen_random_uuid(),
      project_id text,
      construction_site_id text,
      resource_type text not null check (resource_type in ('labor','machine')),
      catalog_item_id text not null,
      price_book_item_id text not null references public.internal_price_book(id) on delete restrict,
      rate_unit text not null check (rate_unit in ('labor_hour','person_day','machine_hour','shift')),
      standard_hours numeric,
      effective_from date not null,
      effective_to date,
      is_active boolean not null default true,
      created_by uuid references public.users(id),
      updated_by uuid references public.users(id),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      check (standard_hours is null or standard_hours > 0),
      check (rate_unit not in ('person_day','shift') or standard_hours is not null)
    );

Binding precedence là exact construction_site_id, rồi project_id, rồi global; trong cùng scope chọn effective_from mới nhất phù hợp ngày nhật ký.

- [ ] **Step 4: Tạo accrual table**

    create table public.project_resource_cost_accruals (
      id uuid primary key default gen_random_uuid(),
      project_id text,
      construction_site_id text,
      task_id text not null references public.project_tasks(id),
      work_item_id uuid not null references public.daily_log_work_items(id),
      source_daily_log_id text not null references public.daily_logs(id),
      source_table text not null check (source_table in ('daily_log_labor','daily_log_machines')),
      source_line_id uuid not null,
      resource_type text not null check (resource_type in ('labor','machine')),
      cost_item_code_snapshot text not null check (cost_item_code_snapshot in ('I.2','I.3')),
      usage_quantity numeric not null check (usage_quantity >= 0),
      usage_unit text not null,
      standard_hours_snapshot numeric,
      rate_amount numeric,
      rate_unit text,
      rate_source_type text,
      rate_source_id text,
      rate_effective_date date,
      estimated_amount numeric,
      matched_actual_amount numeric not null default 0,
      variance_amount numeric,
      pricing_status text not null,
      reconciliation_status text not null default 'unmatched',
      pricing_error_code text,
      voided_at timestamptz,
      void_reason text,
      created_by uuid references public.users(id),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

Unique partial index trên source_table, source_line_id khi voided_at is null.

- [ ] **Step 5: Thêm quyền**

Thêm view_cost và reconcile_cost vào PROJECT_ROOM_ACTION_CODES; chỉ Payment Room cho phép hai action. Migration đồng thời cập nhật `allowed_actions` của Payment Room, upsert enforcement binding và để binding ban đầu ở `audit_only` cho đúng scope pilot. Map:

    view_cost: ['project.payment.view_resource_cost']
    reconcile_cost: ['project.payment.reconcile_resource_cost']

Migration upsert permission catalog risk sensitive, direct grant expiry; binding ban đầu audit_only, không backfill rộng.

- [ ] **Step 6: RLS và payload boundary**

- Rate bindings/internal price chỉ SELECT qua RPC cho actor có payment view_cost.
- Accrual amount chỉ đọc qua finance RPC.
- Daily Log bundle trả pricingStatus cho người hiện trường nhưng không select rate_amount/estimated_amount.
- Direct writes authenticated bị revoke.
- Cloud smoke chạy dưới persona không có `view_cost`: finance RPC bị deny; status RPC chỉ trả `priced/unpriced` và JSON không chứa `rateAmount`, `estimatedAmount` hoặc `matchedActualAmount`.

- [ ] **Step 7: Chạy test**

Run: npm test -- lib/__tests__/resourceCostAccrualFoundationMigration.test.ts lib/__tests__/projectRoomEffectiveActions.test.ts lib/__tests__/permissionRegistry.test.ts

Run: npm run check:supabase-migrations

Run: npx --no-install supabase db query --linked --agent=no --file supabase/tests/resource_cost_permission_boundary_smoke.sql

Expected: PASS; smoke rollback sạch và persona hiện trường không đọc được amount/rate.

- [ ] **Step 8: Commit**

    git add supabase/migrations/20260923110000_resource_cost_accrual_foundation.sql supabase/tests/resource_cost_permission_boundary_smoke.sql lib/__tests__/resourceCostAccrualFoundationMigration.test.ts lib/permissions/projectPermissionRooms.ts lib/permissions/projectRoomEffectiveActions.ts lib/permissions/projectPermissionRegistry.ts lib/supabaseProjections.ts
    git commit -m "feat(cost): add resource accrual foundation"

---

### Task 3: Quản trị mapping catalog sang nguồn đơn giá

**Files:**
- Create: lib/projectResourceCostService.ts
- Create: components/project/finance/ResourceRateBindingPanel.tsx
- Create: lib/__tests__/projectResourceRateBinding.test.tsx
- Create: supabase/migrations/20260923111500_resource_rate_binding_commands.sql
- Modify: pages/project/ProjectFinanceWorkspace.tsx

**Interfaces:**
- Produces: list_project_resource_rate_bindings_v1(), replace_project_resource_rate_binding_v1(), projectResourceCostService.listRateBindings()/saveRateBinding().
- Consumes: internal_price_book active labor/machine rows và payment view_cost/reconcile_cost.

- [ ] **Step 1: Viết test fail**

Test panel chỉ liệt kê labor/machine active price rows, yêu cầu explicit rateUnit và standardHours cho person_day/shift; actor thiếu view_cost không thấy amount.

    expect(screen.getByText('Đơn giá theo ngày công')).toBeVisible();
    expect(screen.getByLabelText('Giờ tiêu chuẩn/ngày')).toBeRequired();
    expect(screen.queryByText('800.000 đ')).not.toBeInTheDocument();

- [ ] **Step 2: Chạy test để xác nhận fail**

Run: npm test -- lib/__tests__/projectResourceRateBinding.test.tsx

Expected: FAIL.

- [ ] **Step 3: Tạo read/write RPC**

list RPC chỉ trả price amount khi actor có view_cost. replace RPC yêu cầu reconcile_cost, kiểm tra catalog tồn tại đúng type, price book active/effective, unit tương thích và expected updated_at.

- [ ] **Step 4: Implement service**

    export const projectResourceCostService = {
      listRateBindings(input: ResourceCostScopeInput): Promise<ProjectResourceRateBinding[]>,
      saveRateBinding(input: SaveProjectResourceRateBindingInput): Promise<ProjectResourceRateBinding>,
    };

- [ ] **Step 5: Implement panel**

Panel nhóm Nhân công/Máy, hiển thị catalog chưa binding trước, nguồn giá, unit, hiệu lực và giờ tiêu chuẩn. Không cho lưu day/shift thiếu standard hours; không đổi internal_price_book tại màn này.

- [ ] **Step 6: Chạy test và typecheck**

Run: npm test -- lib/__tests__/projectResourceRateBinding.test.tsx

Run: npm run lint

Expected: PASS.

- [ ] **Step 7: Commit**

    git add lib/projectResourceCostService.ts components/project/finance/ResourceRateBindingPanel.tsx lib/__tests__/projectResourceRateBinding.test.tsx supabase/migrations/20260923111500_resource_rate_binding_commands.sql pages/project/ProjectFinanceWorkspace.tsx
    git commit -m "feat(cost): configure resource rate bindings"

---

### Task 4: Sinh accrual khi CHT công bố bản tổng hợp

**Files:**
- Create: supabase/migrations/20260923113000_resource_cost_pricing_publication.sql
- Create: supabase/tests/resource_cost_accrual_smoke.sql
- Create: lib/__tests__/resourceCostPricingPublicationMigration.test.ts
- Modify: lib/dailyLogWbsService.ts

**Interfaces:**
- Produces: app_private.upsert_daily_log_resource_accruals_v1().
- Consumes: publish_daily_log_summary_v1() từ Plan 1, rate bindings Task 2–3.

- [ ] **Step 1: Viết contract test fail**

    expect(sql).toContain('upsert_daily_log_resource_accruals_v1');
    expect(sql).toContain("summary_source_type = 'member_contributions'");
    expect(sql).toContain("'unpriced'");
    expect(sql).toContain('standard_hours_snapshot');
    expect(sql).not.toContain('insert into public.project_transactions');

- [ ] **Step 2: Chạy test để xác nhận fail**

Run: npm test -- lib/__tests__/resourceCostPricingPublicationMigration.test.ts

Expected: FAIL.

- [ ] **Step 3: Implement pricing helper**

Helper nhận summary log id, query normalized summary labor/machine only, tính total hours từ explicit semantics, resolve binding theo scope/date và snapshot price book. Labor snapshot vào cost item `I.2`, machine vào `I.3`; đây chỉ là nhánh Estimated và không thay đổi actual tree. Thiếu binding/unit/standard hours tạo unpriced với estimated_amount null và pricing_error_code. Dòng legacy chưa có peopleCount/hoursPerPerson hoặc machineCount/hoursPerMachine được ghi `ambiguous_legacy_hours`, không tự diễn giải cột `hours` cũ.

- [ ] **Step 4: Gắn helper vào publish transaction**

Dùng create or replace function trong migration mới để bổ sung lời gọi helper trước khi commit verified status. Không sửa migration Plan 1 đã chạy. Retry command không tạo duplicate accrual; revision void accrual cũ bằng reason superseded_by_revision.

- [ ] **Step 5: Viết Cloud smoke**

Smoke kiểm tra:

- labor_hour và shift được tính đúng;
- thiếu binding tạo unpriced/null, không phải 0;
- source contribution không tạo accrual;
- retry không duplicate;
- revision void accrual cũ;
- project_transactions count không đổi.

- [ ] **Step 6: Chạy test và smoke**

Run: npm test -- lib/__tests__/resourceCostPricingPublicationMigration.test.ts

Run: npx --no-install supabase db query --linked --agent=no --file supabase/tests/resource_cost_accrual_smoke.sql

Expected: PASS, rollback sạch.

- [ ] **Step 7: Commit**

    git add supabase/migrations/20260923113000_resource_cost_pricing_publication.sql supabase/tests/resource_cost_accrual_smoke.sql lib/__tests__/resourceCostPricingPublicationMigration.test.ts lib/dailyLogWbsService.ts
    git commit -m "feat(cost): price verified daily log resources"

---

### Task 5: Hiển thị trạng thái định giá và báo cáo Estimated/Actual

**Files:**
- Create: components/project/daily-log/ResourcePricingStatus.tsx
- Create: components/project/finance/ResourceCostAccrualPanel.tsx
- Create: lib/__tests__/resourceCostVisibility.test.tsx
- Modify: components/project/daily-log/DailyLogWorkItemTable.tsx
- Modify: components/project/daily-log/DailyLogAreaCard.tsx
- Modify: pages/project/ProjectFinanceWorkspace.tsx
- Modify: lib/projectCostItemService.ts
- Modify: lib/projectResourceCostService.ts

**Interfaces:**
- Produces: get_project_resource_cost_overview_v1(), projectResourceCostService.getOverview(), ResourceCostOverview và hai mức projection.
- Consumes: accrual Task 4, project_transactions actual hiện có.

- [ ] **Step 1: Viết visibility test fail**

Với site user:

    expect(screen.getByText('Chưa định giá')).toBeVisible();
    expect(screen.queryByText(/đ$/)).not.toBeInTheDocument();

Với finance viewer:

    expect(screen.getByText('Tạm tính')).toBeVisible();
    expect(screen.getByText('Thực tế')).toBeVisible();
    expect(screen.getByText('Chưa đối soát')).toBeVisible();
    expect(screen.getByText('Chênh lệch')).toBeVisible();

- [ ] **Step 2: Chạy test để xác nhận fail**

Run: npm test -- lib/__tests__/resourceCostVisibility.test.tsx

Expected: FAIL.

- [ ] **Step 3: Tạo overview RPC**

get_project_resource_cost_overview_v1(project, site, from, to) yêu cầu payment view_cost và trả theo task/WBS/resource:

    {
      "estimatedAmount": 12000000,
      "actualAmount": 10000000,
      "matchedAmount": 8000000,
      "unmatchedEstimatedAmount": 4000000,
      "varianceAmount": -2000000,
      "unpricedCount": 3
    }

RPC trả contract `ResourceCostOverview`; từng row giữ `costItemCode` để gắn Estimated vào `I.2` (nhân công) hoặc `I.3` (máy) mà không nhập vào `actualAmount`.

Adapter gọi đúng RPC và không nhận tùy chọn bypass permission:

    getOverview(input: ResourceCostScopeInput & {
      fromDate: string;
      toDate: string;
    }): Promise<ResourceCostOverview>

Actual lấy project_transactions; không cộng estimated vào actual.

- [ ] **Step 4: Implement status tại Nhật ký**

ResourcePricingStatus chỉ nhận pricingStatus và reasonCode cho site user. Amount props chỉ được truyền khi bundle canViewCost = true. Unknown hiển thị Chưa định giá, không hiển thị 0 đồng.

- [ ] **Step 5: Implement finance panel**

Panel có KPI Estimated/Actual/Unmatched/Variance, filter date/WBS/status, expandable labor/machine lines và link về nhật ký. Tích hợp vào ProjectFinanceWorkspace cạnh CostAnalysisPanel; không thay actualAmount hiện có bằng estimated.

- [ ] **Step 6: Mở rộng cost analysis model không phá nghĩa actual**

Thêm optional estimatedResourceAmount, unmatchedResourceAmount, unpricedResourceCount vào ProjectContractCostAnalysisNode. actualAmount tiếp tục chỉ từ project_transactions.

- [ ] **Step 7: Chạy test**

Run: npm test -- lib/__tests__/resourceCostVisibility.test.tsx

Run: npm run lint

Run: npm run build

Expected: PASS.

- [ ] **Step 8: Commit**

    git add components/project/daily-log/ResourcePricingStatus.tsx components/project/finance/ResourceCostAccrualPanel.tsx components/project/daily-log/DailyLogWorkItemTable.tsx components/project/daily-log/DailyLogAreaCard.tsx pages/project/ProjectFinanceWorkspace.tsx lib/projectCostItemService.ts lib/projectResourceCostService.ts lib/__tests__/resourceCostVisibility.test.tsx
    git commit -m "feat(cost): expose provisional resource cost safely"

---

### Task 6: Đối soát accrual với project transaction

**Files:**
- Create: supabase/migrations/20260923120000_resource_cost_reconciliation.sql
- Create: supabase/tests/resource_cost_reconciliation_smoke.sql
- Create: components/project/finance/ResourceCostReconciliationDrawer.tsx
- Create: lib/__tests__/resourceCostReconciliation.test.tsx
- Modify: lib/projectResourceCostService.ts
- Modify: components/project/finance/ResourceCostAccrualPanel.tsx

**Interfaces:**
- Produces: project_resource_cost_matches, reconcile_project_resource_cost_v1(), reverse_project_resource_cost_match_v1().
- Consumes: project_transactions expense rows và reconcile_cost permission.

- [ ] **Step 1: Viết migration/UI test fail**

    expect(sql).toContain('create table public.project_resource_cost_matches');
    expect(sql).toContain('reconcile_project_resource_cost_v1');
    expect(sql).toContain('reverse_project_resource_cost_match_v1');
    expect(sql).toContain('matched_amount');
    expect(sql).toContain('for update');

UI test nhập phân bổ vượt số dư và thấy:

    expect(screen.getByText('Số tiền đối soát vượt giá trị còn lại')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Xác nhận đối soát' })).toBeDisabled();

- [ ] **Step 2: Chạy test để xác nhận fail**

Run: npm test -- lib/__tests__/resourceCostReconciliation.test.tsx

Expected: FAIL.

- [ ] **Step 3: Tạo match table**

    create table public.project_resource_cost_matches (
      id uuid primary key default gen_random_uuid(),
      accrual_id uuid not null references public.project_resource_cost_accruals(id),
      project_transaction_id text not null references public.project_transactions(id),
      matched_amount numeric not null check (matched_amount > 0),
      matched_quantity numeric,
      note text,
      matched_by uuid not null references public.users(id),
      matched_at timestamptz not null default now(),
      reversed_by uuid references public.users(id),
      reversed_at timestamptz,
      reversal_reason text
    );

- [ ] **Step 4: Tạo reconcile/reverse command**

Command yêu cầu reconcile_cost, exact project/site, expense transaction, accrual không void. Khóa accrual, transaction và active matches; tổng phân bổ không vượt abs(transaction.amount) hoặc estimated amount trừ khi payload có approved exception reason và actor admin. Retry với command id không tạo duplicate.

Reverse không xóa row; bắt buộc reason, cập nhật status accrual và audit.

- [ ] **Step 5: Implement service/drawer**

    reconcile(input: {
      commandId: string;
      accrualId: string;
      projectTransactionId: string;
      matchedAmount: number;
      matchedQuantity?: number | null;
      note?: string | null;
    }): Promise<ResourceCostReconciliationReceipt>

Drawer chỉ liệt kê expense transaction đúng scope, hiển thị amount/remaining và hỗ trợ partial match.

- [ ] **Step 6: Chạy Cloud smoke**

Smoke kiểm tra partial, full, over-allocation rollback, duplicate retry, cross-scope denied, void denied, reverse audit và project_transactions không bị thay đổi.

Run: npx --no-install supabase db query --linked --agent=no --file supabase/tests/resource_cost_reconciliation_smoke.sql

Expected: PASS, rollback sạch.

- [ ] **Step 7: Chạy unit/typecheck**

Run: npm test -- lib/__tests__/resourceCostReconciliation.test.tsx

Run: npm run lint

Expected: PASS.

- [ ] **Step 8: Commit**

    git add supabase/migrations/20260923120000_resource_cost_reconciliation.sql supabase/tests/resource_cost_reconciliation_smoke.sql components/project/finance/ResourceCostReconciliationDrawer.tsx components/project/finance/ResourceCostAccrualPanel.tsx lib/projectResourceCostService.ts lib/__tests__/resourceCostReconciliation.test.tsx
    git commit -m "feat(cost): reconcile resource accruals with actuals"

---

### Task 7: Full verification, pilot và handoff

**Files:**
- Create: supabase/operations/resource_cost_accrual_pilot.sql
- Create: lib/__tests__/resourceCostNoDoubleCount.test.ts
- Modify: docs/runbooks/erp-completion-pilot-rollout.md
- Modify: docs/designs/erp-completion-2026-09-19/progress.md
- Modify: docs/designs/erp-completion-2026-09-19/HANDOFF.md

**Interfaces:**
- Consumes: Task 1–6 và Completion Gate Plan 1.
- Produces: pilot operation, no-double-count evidence, support/rollback handoff.

- [ ] **Step 1: Viết no-double-count test fail**

Test projectCostItemService giữ:

    expect(node.actualAmount).toBe(10000000);
    expect(node.estimatedResourceAmount).toBe(12000000);
    expect(node.actualAmount).not.toBe(22000000);
    expect(node.unmatchedResourceAmount).toBe(4000000);

- [ ] **Step 2: Chạy test để xác nhận fail**

Run: npm test -- lib/__tests__/resourceCostNoDoubleCount.test.ts

Expected: FAIL trước khi read model hoàn chỉnh.

- [ ] **Step 3: Tạo pilot operation**

Operation bật binding/accrual UI cho đúng project/site, chuyển view_cost/reconcile_cost từ audit_only sang pilot cho đúng template/người được duyệt, ghi owner/reason/expiry. Rollback pause pricing publication mới nhưng vẫn cho completion/reconciliation của accrual đã sinh; không xóa accrual/match.

- [ ] **Step 4: Chạy full verification**

Run: npm test

Run: npm run lint

Run: npm run build

Run: npm run check:supabase-migrations

Run: npx --no-install supabase db query --linked --agent=no --file supabase/tests/resource_cost_accrual_smoke.sql

Run: npx --no-install supabase db query --linked --agent=no --file supabase/tests/resource_cost_reconciliation_smoke.sql

Run: npx --no-install supabase db query --linked --agent=no --file supabase/operations/resource_cost_accrual_pilot.sql

Expected: tất cả PASS; operation ở chế độ preflight in query plan của overview RPC cho scope/ngày truyền bằng psql variables, không hardcode giá trị production.

- [ ] **Step 5: Pilot bằng persona thật**

Kiểm tra:

1. Cán bộ hiện trường chỉ thấy Đã định giá/Chưa định giá, không thấy rate/amount.
2. CHT publish summary có priced và unpriced accrual đúng WBS.
3. Finance viewer thấy Estimated/Actual/Unmatched riêng.
4. Reconciler partial/full match đúng transaction.
5. User thiếu view_cost/reconcile_cost bị deny RPC.
6. Revision void accrual cũ, không tăng actual.

- [ ] **Step 6: Đo số liệu**

Truy vấn và lưu evidence:

- tổng labor/machine lines verified;
- tỷ lệ linked WBS;
- priced/unpriced count;
- duplicate active accrual count phải bằng 0;
- over-allocated transaction count phải bằng 0;
- chênh actual trước/sau rollout phải bằng 0 nếu chưa có chứng từ mới.

- [ ] **Step 7: Cập nhật runbook/handoff**

Ghi cách thêm binding, xử lý unpriced, reverse match, pause rollout, hỗ trợ incident và evidence paths. HANDOFF ghi commit/migration/test/Cloud state, không chứa secret.

- [ ] **Step 8: Commit**

    git add supabase/operations/resource_cost_accrual_pilot.sql lib/__tests__/resourceCostNoDoubleCount.test.ts docs/runbooks/erp-completion-pilot-rollout.md docs/designs/erp-completion-2026-09-19/progress.md docs/designs/erp-completion-2026-09-19/HANDOFF.md
    git commit -m "docs(cost): complete resource accrual pilot handoff"

---

## Completion Gate

Plan 2 hoàn thành khi:

- Verified summary tạo đúng một active accrual cho mỗi labor/machine source line.
- Unpriced luôn là null amount với lý do; không có 0 giả.
- Người thiếu quyền không thể đọc rate hoặc amount bằng UI/RPC/direct table.
- Estimated không được cộng vào actual project transaction.
- Partial/full/reverse reconciliation có audit và không over-allocate.
- Revision void đúng accrual cũ, không nhân đôi actual.
- Unit, migration contract, Cloud smoke, typecheck và build đều pass.
- Pilot evidence chứng minh không duplicate, không permission leak và không double-count.
