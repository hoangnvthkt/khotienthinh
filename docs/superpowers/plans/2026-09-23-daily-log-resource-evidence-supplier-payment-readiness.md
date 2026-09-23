# Daily Log Resource Evidence and Supplier Payment Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cung cấp dữ liệu nhân công/máy đã được CHT xác nhận theo NCC/đội, ngày, khu vực và WBS để làm căn cứ cho quy trình thanh toán về sau, hoàn toàn không lưu giá hoặc tính tiền trong Nhật ký.

**Architecture:** Dùng chính các dòng daily_log_labor/daily_log_machines semantics version 2 thuộc summary verified làm bằng chứng nguồn lực; không tạo sổ accrual hay bảng giá trung gian. Một RPC read model có allowlist trường vật lý và lineage, được bảo vệ bằng Payment Room action riêng; UI chỉ đọc cung cấp tổng quan và drill-down về Nhật ký gốc.

**Tech Stack:** React 18, TypeScript 5.8, Vite 6, Vitest 4, Supabase/PostgreSQL/RLS/RPC, Tailwind utility classes, lucide-react.

**Spec:** docs/superpowers/specs/2026-09-23-daily-log-wbs-progress-resources-cost-design.md

**Prerequisite:** docs/superpowers/plans/2026-09-23-daily-log-wbs-area-summary-progress.md đã qua Completion Gate.

## Global Constraints

- Thực thi bằng agent chính với superpowers:executing-plans; AGENTS.md cấm sub-agent.
- Mọi thao tác Supabase dùng Supabase Cloud từ cấu hình .env; không dùng Supabase local hoặc Docker.
- Chỉ summary `member_contributions` ở trạng thái verified mới xuất hiện trong read model bằng chứng.
- Mặc định chỉ revision đang hiệu lực; revision superseded chỉ hiện khi người dùng chủ động mở lịch sử.
- Nguồn catalog giữ partner id và snapshot mã/tên; nguồn manual giữ type/name/note snapshot, không tự tạo BusinessPartner.
- Không đọc internal_price_book; không trả unit_cost, total_cost, rate, amount, currency hoặc trạng thái định giá.
- Không tạo project_resource_cost_accruals, project_resource_cost_matches hoặc project_transactions.
- QS/thanh toán chỉ đọc; không được sửa Nhật ký verified qua màn bằng chứng.
- Dữ liệu semantics version 1 không được tự diễn giải; hiển thị riêng là legacy chưa chuẩn hóa.
- Giữ Design System hiện tại; không thêm thư viện UI mới hoặc redesign module tài chính.
- Dùng TDD, Cloud smoke rollback và commit riêng sau mỗi task.

## Review Focus

1. Hai nguồn manual khác kiểu nhưng trùng tên: không gộp chung; provider key phải gồm mode, type và tên chuẩn hóa — Task 1, 3.
2. Summary có revision: mặc định chỉ revision mới nhất đang hiệu lực; lịch sử vẫn truy cập được và không cộng đôi — Task 1, 3, 5.
3. BusinessPartner bị khóa/xóa sau khi verified: vẫn hiển thị snapshot NCC cũ và link Nhật ký, không làm mất bằng chứng — Task 3, 4.
4. Actor thiếu view_resource_evidence hoặc sai project/site: RPC deny và direct table không trở thành đường vòng — Task 2, 3.
5. Các cột legacy unit_cost/total_cost có dữ liệu: JSON/UI tuyệt đối không chứa giá trị đó và test kiểm tra key bị loại — Task 1, 3, 4.

## File Map

**Tạo mới:**

- lib/resourceUsageEvidenceRules.ts: provider key, allowlist projection và tổng hợp số liệu vật lý.
- lib/projectResourceEvidenceService.ts: adapter RPC read model bằng chứng.
- components/project/finance/ResourceUsageEvidencePanel.tsx: tổng quan/filter/bảng bằng chứng trong Payment workspace.
- components/project/finance/ResourceUsageEvidenceDrawer.tsx: drill-down lineage về summary/card/contribution.
- supabase/migrations/20260923110000_resource_evidence_permission.sql.
- supabase/migrations/20260923111500_verified_resource_usage_evidence.sql.
- supabase/tests/resource_usage_evidence_smoke.sql.
- supabase/operations/resource_usage_evidence_pilot.sql.
- Các unit/contract/UI test nêu trong từng task.

**Sửa chính:**

- types.ts, lib/supabaseProjections.ts.
- lib/permissions/projectPermissionRooms.ts, lib/permissions/projectRoomEffectiveActions.ts, lib/permissions/projectPermissionRegistry.ts.
- pages/project/ProjectFinanceWorkspace.tsx.
- docs/runbooks/erp-completion-pilot-rollout.md.
- docs/designs/erp-completion-2026-09-19/progress.md, docs/designs/erp-completion-2026-09-19/HANDOFF.md.

---

### Task 1: Khóa contract bằng chứng và phép tổng hợp số liệu vật lý

**Files:**
- Create: lib/resourceUsageEvidenceRules.ts
- Create: lib/__tests__/resourceUsageEvidenceRules.test.ts
- Modify: types.ts

**Interfaces:**
- Consumes: DailyLogResourceProvider, DailyLogLabor, DailyLogMachine và revision lineage từ Plan 1.
- Produces: VerifiedResourceUsageEvidence, ResourceEvidenceProvider, ResourceEvidenceFilters, ResourceEvidenceGroup, buildResourceEvidenceProviderKey(), sanitizeResourceEvidenceRow(), groupResourceEvidence().

- [ ] **Step 1: Viết unit test fail**

    import { describe, expect, it } from 'vitest';
    import {
      buildResourceEvidenceProviderKey,
      groupResourceEvidence,
      sanitizeResourceEvidenceRow,
    } from '../resourceUsageEvidenceRules';

    const laborEvidence = (overrides: Partial<VerifiedResourceUsageEvidence> = {}): VerifiedResourceUsageEvidence => Object.assign({
      resourceLineId: crypto.randomUUID(),
      resourceType: 'labor',
      dailyLogId: 'summary-1',
      summarySourceId: 'source-1',
      contributionId: 'contribution-1',
      revisionNo: 1,
      revisionState: 'current',
      projectId: 'project-1',
      constructionSiteId: 'site-1',
      logDate: '2026-09-23',
      workAreaCode: 'A',
      workAreaName: 'Khu A',
      taskId: 'task-1',
      wbsCode: '1.1',
      taskName: 'Bê tông móng',
      provider: { entryMode: 'catalog', partnerId: 'partner-1', providerNameSnapshot: 'Công ty An Phát' },
      peopleCount: 5,
      hoursPerPerson: 6,
      totalLaborHours: 30,
      sourceUserName: 'Nguyễn Văn A',
      verifiedByName: 'Chỉ huy trưởng',
      verifiedAt: '2026-09-23T10:00:00Z',
    }, overrides);

    describe('resourceUsageEvidenceRules', () => {
      it('keeps manual providers with different types separate', () => {
        expect(buildResourceEvidenceProviderKey({
          entryMode: 'manual',
          manualProviderType: 'day_labor',
          manualProviderName: 'Tổ Anh Minh',
        })).not.toBe(buildResourceEvidenceProviderKey({
          entryMode: 'manual',
          manualProviderType: 'machine_owner',
          manualProviderName: 'Tổ Anh Minh',
        }));
      });

      it('groups catalog evidence by partner id and sums only physical quantities', () => {
        const groups = groupResourceEvidence([laborEvidence({ totalLaborHours: 30 }), laborEvidence({ totalLaborHours: 10 })]);
        expect(groups[0]).toMatchObject({ providerKey: 'catalog:partner-1', totalLaborHours: 40 });
        expect(groups[0]).not.toHaveProperty('amount');
      });

      it('drops legacy money fields from an untrusted database row', () => {
        const row = sanitizeResourceEvidenceRow({
          resource_line_id: 'labor-1',
          resource_type: 'labor',
          total_labor_hours: 8,
          unit_cost: 900000,
          total_cost: 900000,
        });
        expect(row).not.toHaveProperty('unitCost');
        expect(row).not.toHaveProperty('totalCost');
        expect(JSON.stringify(row)).not.toContain('900000');
      });
    });

- [ ] **Step 2: Chạy test để xác nhận fail**

Run: npm test -- lib/__tests__/resourceUsageEvidenceRules.test.ts

Expected: FAIL vì module/types chưa tồn tại.

- [ ] **Step 3: Thêm types công khai**

    export type ResourceEvidenceType = 'labor' | 'machine';
    export type ResourceEvidenceRevisionState = 'current' | 'superseded';

    export interface ResourceEvidenceProvider {
      entryMode: 'catalog' | 'manual';
      partnerId?: string | null;
      providerCodeSnapshot?: string | null;
      providerNameSnapshot?: string | null;
      manualProviderType?: DailyLogManualProviderType | null;
      manualProviderName?: string | null;
      manualProviderNote?: string | null;
    }

    export interface VerifiedResourceUsageEvidence {
      resourceLineId: string;
      resourceType: ResourceEvidenceType;
      dailyLogId: string;
      summarySourceId: string;
      contributionId: string;
      revisionNo: number;
      revisionState: ResourceEvidenceRevisionState;
      projectId?: string | null;
      constructionSiteId?: string | null;
      logDate: string;
      workAreaCode: string;
      workAreaName: string;
      taskId: string;
      wbsCode?: string | null;
      taskName: string;
      provider: ResourceEvidenceProvider;
      peopleCount?: number | null;
      hoursPerPerson?: number | null;
      totalLaborHours?: number | null;
      machineCount?: number | null;
      hoursPerMachine?: number | null;
      totalMachineHours?: number | null;
      sourceUserName?: string | null;
      verifiedByName?: string | null;
      verifiedAt: string;
    }

    export interface ResourceEvidenceFilters {
      projectId: string;
      constructionSiteId?: string | null;
      fromDate: string;
      toDate: string;
      providerKey?: string | null;
      taskId?: string | null;
      resourceType?: ResourceEvidenceType | null;
      includeSuperseded?: boolean;
      cursor?: string | null;
      limit?: number;
    }

    export interface ResourceEvidenceGroup {
      providerKey: string;
      provider: ResourceEvidenceProvider;
      peopleCount: number;
      totalLaborHours: number;
      machineCount: number;
      totalMachineHours: number;
      lineCount: number;
    }

- [ ] **Step 4: Implement provider key và allowlist projection**

    const normalizeProviderName = (value: string) => value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');

    export const buildResourceEvidenceProviderKey = (provider: ResourceEvidenceProvider) =>
      provider.entryMode === 'catalog'
        ? `catalog:${provider.partnerId}`
        : `manual:${provider.manualProviderType}:${normalizeProviderName(provider.manualProviderName || '')}`;

    export const sanitizeResourceEvidenceRow = (row: Record<string, unknown>): VerifiedResourceUsageEvidence => ({
      resourceLineId: String(row.resource_line_id),
      resourceType: row.resource_type as ResourceEvidenceType,
      dailyLogId: String(row.daily_log_id),
      summarySourceId: String(row.summary_source_id),
      contributionId: String(row.contribution_id),
      revisionNo: Number(row.revision_no || 1),
      revisionState: row.revision_state as ResourceEvidenceRevisionState,
      projectId: row.project_id == null ? null : String(row.project_id),
      constructionSiteId: row.construction_site_id == null ? null : String(row.construction_site_id),
      logDate: String(row.log_date),
      workAreaCode: String(row.work_area_code),
      workAreaName: String(row.work_area_name),
      taskId: String(row.task_id),
      wbsCode: row.wbs_code == null ? null : String(row.wbs_code),
      taskName: String(row.task_name),
      provider: row.provider as ResourceEvidenceProvider,
      peopleCount: row.people_count == null ? null : Number(row.people_count),
      hoursPerPerson: row.hours_per_person == null ? null : Number(row.hours_per_person),
      totalLaborHours: row.total_labor_hours == null ? null : Number(row.total_labor_hours),
      machineCount: row.machine_count == null ? null : Number(row.machine_count),
      hoursPerMachine: row.hours_per_machine == null ? null : Number(row.hours_per_machine),
      totalMachineHours: row.total_machine_hours == null ? null : Number(row.total_machine_hours),
      sourceUserName: row.source_user_name == null ? null : String(row.source_user_name),
      verifiedByName: row.verified_by_name == null ? null : String(row.verified_by_name),
      verifiedAt: String(row.verified_at),
    });

groupResourceEvidence() dùng buildResourceEvidenceProviderKey(), chỉ cộng peopleCount, totalLaborHours, machineCount, totalMachineHours và lineCount. Không dùng spread object từ database row để tránh làm lọt trường tiền ngoài allowlist.

- [ ] **Step 5: Chạy unit test và typecheck**

Run: npm test -- lib/__tests__/resourceUsageEvidenceRules.test.ts

Run: npm run lint

Expected: PASS.

- [ ] **Step 6: Commit**

    git add types.ts lib/resourceUsageEvidenceRules.ts lib/__tests__/resourceUsageEvidenceRules.test.ts
    git commit -m "feat(daily-log): define verified resource evidence contract"

---

### Task 2: Thêm quyền xem bằng chứng nguồn lực cho QS/thanh toán

**Files:**
- Create: supabase/migrations/20260923110000_resource_evidence_permission.sql
- Create: lib/__tests__/resourceEvidencePermission.test.ts
- Modify: lib/permissions/projectPermissionRooms.ts
- Modify: lib/permissions/projectRoomEffectiveActions.ts
- Modify: lib/permissions/projectPermissionRegistry.ts

**Interfaces:**
- Consumes: Payment Room registry và current_actor_has_effective_room_action().
- Produces: action view_resource_evidence, permission project.payment.view_resource_evidence và getPaymentPermissionCodesForEffectiveRoomActions().

- [ ] **Step 1: Viết permission test fail**

    expect(PROJECT_ROOM_ACTION_CODES).toContain('view_resource_evidence');
    expect(getProjectPermissionRoom('payment')?.actions).toContain('view_resource_evidence');
    expect(getPaymentPermissionCodesForEffectiveRoomActions(['view_resource_evidence']))
      .toEqual(['project.payment.view_resource_evidence']);

- [ ] **Step 2: Chạy test để xác nhận fail**

Run: npm test -- lib/__tests__/resourceEvidencePermission.test.ts

Expected: FAIL vì action/permission chưa tồn tại.

- [ ] **Step 3: Mở rộng registry và migration**

Thêm `view_resource_evidence` vào PROJECT_ROOM_ACTION_CODES, label `Xem bằng chứng nguồn lực`, chỉ đưa action vào Payment Room. Thêm helper với map duy nhất:

    view_resource_evidence: ['project.payment.view_resource_evidence']

Migration thêm action vào allowed_actions của Payment Room, upsert permission risk `sensitive`, direct grant yêu cầu expiry và binding ban đầu `audit_only`. Không map từ payment view chung và không backfill rộng.

- [ ] **Step 4: Viết migration contract test**

    expect(sql).toContain('project.payment.view_resource_evidence');
    expect(sql).toContain("'view_resource_evidence'");
    expect(sql).toContain("'audit_only'");
    expect(sql).not.toContain('project.payment.view_cost');
    expect(sql).not.toContain('project.payment.reconcile_resource_cost');

- [ ] **Step 5: Chạy test**

Run: npm test -- lib/__tests__/resourceEvidencePermission.test.ts lib/__tests__/projectRoomEffectiveActions.test.ts lib/__tests__/permissionRegistry.test.ts

Run: npm run check:supabase-migrations

Expected: PASS.

- [ ] **Step 6: Commit**

    git add supabase/migrations/20260923110000_resource_evidence_permission.sql lib/__tests__/resourceEvidencePermission.test.ts lib/permissions/projectPermissionRooms.ts lib/permissions/projectRoomEffectiveActions.ts lib/permissions/projectPermissionRegistry.ts
    git commit -m "feat(payment): add resource evidence view permission"

---

### Task 3: Tạo RPC bằng chứng verified, revision-safe và không có trường tiền

**Files:**
- Create: supabase/migrations/20260923111500_verified_resource_usage_evidence.sql
- Create: supabase/tests/resource_usage_evidence_smoke.sql
- Create: lib/__tests__/verifiedResourceUsageEvidenceMigration.test.ts
- Modify: lib/supabaseProjections.ts

**Interfaces:**
- Consumes: schema/resource provider snapshot Plan 1 và permission Task 2.
- Produces: get_verified_resource_usage_evidence_v1(filters) trả rows, totals, unknownLegacyCount, nextCursor.

- [ ] **Step 1: Viết migration contract test fail**

    expect(sql).toContain('get_verified_resource_usage_evidence_v1');
    expect(sql).toContain("summary_source_type = 'member_contributions'");
    expect(sql).toContain("status = 'verified'");
    expect(sql).toContain("'view_resource_evidence'");
    expect(sql).toContain('resource_semantics_version = 2');
    expect(sql).not.toContain('unit_cost');
    expect(sql).not.toContain('total_cost');
    expect(sql).not.toContain('internal_price_book');
    expect(sql).not.toContain('project_transactions');

- [ ] **Step 2: Chạy test để xác nhận fail**

Run: npm test -- lib/__tests__/verifiedResourceUsageEvidenceMigration.test.ts

Expected: FAIL vì migration chưa tồn tại.

- [ ] **Step 3: Tạo RPC signature và guard**

    create function public.get_verified_resource_usage_evidence_v1(
      p_project_id text,
      p_construction_site_id text default null,
      p_from_date date default null,
      p_to_date date default null,
      p_provider_key text default null,
      p_task_id text default null,
      p_resource_type text default null,
      p_include_superseded boolean default false,
      p_cursor text default null,
      p_limit integer default 200
    ) returns jsonb
    language plpgsql
    security definer
    set search_path = '';

Guard xác thực active actor, Payment Room `view_resource_evidence`, exact project/site, date range không quá 366 ngày, resource type labor/machine và limit 1–500. Sai scope trả `RESOURCE_EVIDENCE_SCOPE_DENIED`; không fallback quyền legacy.

- [ ] **Step 4: Implement allowlist query và revision rule**

Union labor/machine chỉ từ daily_logs verified member_contributions, join summary source/work item/contribution bằng khóa owner. Mỗi nhánh tạo JSON provider và các trường vật lý bằng jsonb_build_object allowlist:

`providerKey` dùng `catalog:<partner_id>` hoặc `manual:<manual_provider_type>:<lower(unaccent(trim(name)))>` với khoảng trắng rút gọn, đúng cùng semantics với buildResourceEvidenceProviderKey(). Cursor là base64 của `log_date|resource_type|resource_line_id`; query dùng tuple giảm dần `(log_date, resource_type, resource_line_id)` để không offset-scan.

    jsonb_build_object(
      'resourceLineId', resource_line_id,
      'resourceType', resource_type,
      'dailyLogId', daily_log_id,
      'summarySourceId', summary_source_id,
      'contributionId', contribution_id,
      'revisionNo', revision_no,
      'revisionState', revision_state,
      'projectId', project_id,
      'constructionSiteId', construction_site_id,
      'logDate', log_date,
      'workAreaCode', work_area_code,
      'workAreaName', work_area_name,
      'taskId', task_id,
      'wbsCode', wbs_code,
      'taskName', task_name,
      'provider', provider_json,
      'peopleCount', people_count,
      'hoursPerPerson', hours_per_person,
      'totalLaborHours', total_labor_hours,
      'machineCount', machine_count,
      'hoursPerMachine', hours_per_machine,
      'totalMachineHours', total_machine_hours,
      'sourceUserName', source_user_name,
      'verifiedByName', verified_by_name,
      'verifiedAt', verified_at
    )

Mặc định loại log có superseded_by_daily_log_id. Khi include superseded, trả cả lịch sử với revisionState rõ ràng nhưng totals vẫn chỉ tính current. `unknownLegacyCount` đếm verified resource rows semantics version 1 theo scope/date mà không diễn giải hours/shifts.

- [ ] **Step 5: Viết Cloud smoke rollback**

Smoke fixture kiểm tra catalog/manual provider, labor/machine totals, inactive/deleted partner vẫn hiện snapshot, default loại superseded, include history không cộng đôi, cross-scope/permission deny và unknown legacy count. Chèn giá legacy vào fixture rồi assert JSON text không chứa key `unitCost`, `totalCost`, `rate`, `amount`, `currency`; count project_transactions trước/sau không đổi.

- [ ] **Step 6: Chạy contract và Cloud smoke**

Run: npm test -- lib/__tests__/verifiedResourceUsageEvidenceMigration.test.ts

Run: npx --no-install supabase db query --linked --agent=no --file supabase/tests/resource_usage_evidence_smoke.sql

Expected: PASS; smoke kết thúc rollback.

- [ ] **Step 7: Commit**

    git add supabase/migrations/20260923111500_verified_resource_usage_evidence.sql supabase/tests/resource_usage_evidence_smoke.sql lib/__tests__/verifiedResourceUsageEvidenceMigration.test.ts lib/supabaseProjections.ts
    git commit -m "feat(payment): expose verified resource evidence"

---

### Task 4: Xây màn tra cứu bằng chứng nguồn lực không có giá trị tiền

**Files:**
- Create: lib/projectResourceEvidenceService.ts
- Create: components/project/finance/ResourceUsageEvidencePanel.tsx
- Create: components/project/finance/ResourceUsageEvidenceDrawer.tsx
- Create: lib/__tests__/resourceUsageEvidencePanel.test.tsx
- Modify: pages/project/ProjectFinanceWorkspace.tsx

**Interfaces:**
- Consumes: get_verified_resource_usage_evidence_v1(), types/rules Task 1 và permission Task 2.
- Produces: projectResourceEvidenceService.getEvidence(), panel tổng quan/filter/table và drawer lineage chỉ đọc.

- [ ] **Step 1: Viết service/UI test fail**

    await projectResourceEvidenceService.getEvidence({
      projectId: 'project-1',
      constructionSiteId: 'site-1',
      fromDate: '2026-09-01',
      toDate: '2026-09-30',
      limit: 200,
    });

    expect(mockRpc).toHaveBeenCalledWith('get_verified_resource_usage_evidence_v1', expect.objectContaining({
      p_project_id: 'project-1',
      p_construction_site_id: 'site-1',
      p_limit: 200,
    }));

    render(<ResourceUsageEvidencePanel initialData={fixture} />);
    expect(screen.getByText('Bằng chứng nhân công & máy')).toBeVisible();
    expect(screen.getByText('40 giờ công')).toBeVisible();
    expect(screen.getByText('15 giờ máy')).toBeVisible();
    expect(screen.getByText('Tổ anh Minh')).toBeVisible();
    expect(screen.queryByText(/đồng|VNĐ|Đơn giá|Thành tiền/i)).not.toBeInTheDocument();

- [ ] **Step 2: Chạy test để xác nhận fail**

Run: npm test -- lib/__tests__/resourceUsageEvidencePanel.test.tsx

Expected: FAIL vì service/components chưa tồn tại.

- [ ] **Step 3: Implement service adapter**

    export interface ResourceEvidencePage {
      rows: VerifiedResourceUsageEvidence[];
      groups: ResourceEvidenceGroup[];
      unknownLegacyCount: number;
      nextCursor?: string | null;
    }

    export const projectResourceEvidenceService = {
      getEvidence(input: ResourceEvidenceFilters): Promise<ResourceEvidencePage>,
    };

Adapter map snake/camel, chạy sanitizeResourceEvidenceRow() cho từng row và không dùng generic object spread. Map RESOURCE_EVIDENCE_SCOPE_DENIED/PERMISSION_DENIED/INVALID_DATE_RANGE thành copy tiếng Việt có hành động.

- [ ] **Step 4: Implement panel theo công việc người dùng**

Đầu màn hình hiển thị bốn KPI vật lý: số nguồn cung cấp, số người, tổng giờ công, tổng giờ máy. Filter gồm khoảng ngày, WBS, nguồn cung cấp, loại nhân công/máy và toggle lịch sử revision. Bảng nhóm theo provider, mở ra ngày → khu vực → WBS; mỗi dòng có badge `Danh mục`/`Nhập tay` và link `Mở Nhật ký`.

Không có cột rỗng dành cho giá/tiền. `unknownLegacyCount > 0` hiển thị banner “Có dữ liệu cũ chưa đủ semantics, không cộng vào tổng” và link về danh sách legacy.

- [ ] **Step 5: Implement drawer lineage và responsive states**

Drawer hiển thị summary, card khu vực, contribution, người báo cáo, người xác nhận, số lượng/thời gian và revision state. Desktop dùng bảng có sticky provider; tablet cuộn ngang; mobile dùng provider accordion. Test loading skeleton, empty, denied, RPC error, inactive provider snapshot, manual provider, superseded và mobile 390 px.

- [ ] **Step 6: Chạy test, lint và build**

Run: npm test -- lib/__tests__/resourceUsageEvidencePanel.test.tsx lib/__tests__/resourceUsageEvidenceRules.test.ts

Run: npm run lint

Run: npm run build

Expected: PASS.

- [ ] **Step 7: Commit**

    git add lib/projectResourceEvidenceService.ts components/project/finance/ResourceUsageEvidencePanel.tsx components/project/finance/ResourceUsageEvidenceDrawer.tsx pages/project/ProjectFinanceWorkspace.tsx lib/__tests__/resourceUsageEvidencePanel.test.tsx
    git commit -m "feat(payment): add verified resource evidence workspace"

---

### Task 5: Pilot, performance evidence và handoff cho tích hợp thanh toán tương lai

**Files:**
- Create: supabase/operations/resource_usage_evidence_pilot.sql
- Create: lib/resourceEvidenceNoMoneyLeak.ts
- Create: lib/__tests__/resourceEvidenceNoMoneyLeak.test.ts
- Modify: lib/projectResourceEvidenceService.ts
- Modify: docs/runbooks/erp-completion-pilot-rollout.md
- Modify: docs/designs/erp-completion-2026-09-19/progress.md
- Modify: docs/designs/erp-completion-2026-09-19/HANDOFF.md

**Interfaces:**
- Consumes: Task 1–4 và Completion Gate Plan 1.
- Produces: assertResourceEvidenceHasNoMoneyKeys(), pilot operation, query-plan evidence, no-money-leak gate và contract handoff cho payment feature tương lai.

- [ ] **Step 1: Viết no-money-leak regression test fail**

    import { assertResourceEvidenceHasNoMoneyKeys } from '../resourceEvidenceNoMoneyLeak';

    expect(() => assertResourceEvidenceHasNoMoneyKeys({
      rows: [{ resourceLineId: 'labor-1', totalCost: 4000000 }],
    })).toThrow('RESOURCE_EVIDENCE_MONEY_KEY:totalCost');

    expect(() => assertResourceEvidenceHasNoMoneyKeys({
      rows: [{ resourceLineId: 'labor-1', totalLaborHours: 8 }],
    })).not.toThrow();

- [ ] **Step 2: Chạy test để xác nhận fail**

Run: npm test -- lib/__tests__/resourceEvidenceNoMoneyLeak.test.ts

Expected: FAIL vì guard chưa tồn tại.

- [ ] **Step 3: Implement guard và gắn vào service**

    const FORBIDDEN_MONEY_KEYS = /(^|_)(unit_?cost|total_?cost|rate|amount|currency|price)(_|$)/i;

    export const assertResourceEvidenceHasNoMoneyKeys = (value: unknown): void => {
      if (Array.isArray(value)) return value.forEach(assertResourceEvidenceHasNoMoneyKeys);
      if (!value || typeof value !== 'object') return;
      for (const [key, child] of Object.entries(value)) {
        if (FORBIDDEN_MONEY_KEYS.test(key)) throw new Error(`RESOURCE_EVIDENCE_MONEY_KEY:${key}`);
        assertResourceEvidenceHasNoMoneyKeys(child);
      }
    };

projectResourceEvidenceService gọi guard trên page đã sanitize trước khi trả UI. Guard không thay thế allowlist; nó là regression boundary thứ hai.

- [ ] **Step 4: Tạo pilot operation fail-closed**

Operation nhận project/site, from/to date, release id, owner, reason và expiry qua psql variables. Preflight đếm verified summary, catalog/manual provider, legacy unknown, missing provider, duplicate current evidence và kiểm tra Payment Room recipients trước khi chuyển binding view_resource_evidence từ audit_only sang pilot. Rollback đưa binding về audit_only/disabled, không sửa hoặc xóa Nhật ký.

Operation in `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` cho RPC-equivalent query trên đúng scope/date pilot; không hardcode ID production.

- [ ] **Step 5: Chạy full verification**

Run: npm test

Run: npm run lint

Run: npm run build

Run: npm run check:supabase-migrations

Run: npx --no-install supabase db query --linked --agent=no --file supabase/tests/resource_usage_evidence_smoke.sql

Run: npx --no-install supabase db query --linked --agent=no --file supabase/operations/resource_usage_evidence_pilot.sql

Expected: tất cả PASS; operation chạy preflight trước khi bật pilot và lưu query plan evidence.

- [ ] **Step 6: Walkthrough bằng persona thật**

Kiểm tra:

1. Cán bộ hiện trường không thấy đơn giá/thành tiền trong editor hoặc verified detail.
2. CHT thấy NCC danh mục và nguồn nhập tay trước khi duyệt.
3. QS/thanh toán có quyền xem nhóm NCC → ngày → khu vực → WBS và mở Nhật ký gốc.
4. User thiếu quyền hoặc khác scope bị deny RPC/UI.
5. Revision current không cộng cùng superseded; lịch sử vẫn xem được.
6. Provider đã inactive vẫn hiển thị snapshot; legacy unknown không bị cộng vào tổng.

- [ ] **Step 7: Đo số liệu và lưu evidence**

Lưu count verified labor/machine lines, tỷ lệ WBS/provider hợp lệ, catalog/manual split, legacy unknown count, duplicate current evidence count phải bằng 0 và JSON money-key scan phải bằng 0. Xác nhận project_transactions count không đổi trong smoke.

- [ ] **Step 8: Cập nhật runbook/handoff**

Runbook ghi enable/pause/rollback, xử lý provider inactive, manual provider, legacy unknown, revision và support owner. Handoff ghi rõ contract tương lai chỉ được tham chiếu `resourceLineId`; đơn giá/thành tiền/approval thuộc feature thanh toán riêng và không được ghi ngược vào Nhật ký.

- [ ] **Step 9: Commit**

    git add supabase/operations/resource_usage_evidence_pilot.sql lib/resourceEvidenceNoMoneyLeak.ts lib/projectResourceEvidenceService.ts lib/__tests__/resourceEvidenceNoMoneyLeak.test.ts docs/runbooks/erp-completion-pilot-rollout.md docs/designs/erp-completion-2026-09-19/progress.md docs/designs/erp-completion-2026-09-19/HANDOFF.md
    git commit -m "docs(payment): complete resource evidence pilot handoff"

---

## Completion Gate

Plan 2 hoàn thành khi:

- Mọi dòng resource mới trong summary verified có provider catalog/manual hợp lệ và lineage đầy đủ.
- Read model mặc định chỉ trả evidence current, không cộng đôi revision superseded.
- Legacy semantics version 1 được đếm riêng và không bị tự diễn giải.
- Người sai quyền/scope không đọc được RPC; direct table không là đường vòng.
- JSON, UI và tài liệu không chứa đơn giá, thành tiền hoặc trạng thái định giá.
- Không có migration/command nào tạo accrual, match hoặc project transaction.
- Unit, migration contract, Cloud smoke, typecheck, build và query-plan evidence đều pass.
- Pilot chứng minh tra cứu được NCC → ngày → khu vực → WBS và mở lại Nhật ký gốc trên desktop/tablet/mobile.
