# HRM Org Chart and Workforce Planning Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thay giao diện slot kỹ thuật bằng sơ đồ tổng quan và định biên gộp, đồng thời biến phân bổ tổ chức đang hiệu lực thành nguồn dữ liệu chính cho vị trí hiện tại của nhân viên.

**Architecture:** Tiếp tục dùng `hrm_org_position_slots` làm các chỗ làm việc kỹ thuật nhưng chỉ tổng hợp các slot nguồn `workforce_plan` trên giao diện. Các RPC nguyên tử chịu trách nhiệm tăng/giảm định biên, chọn slot trống, phân bổ/chuyển/gỡ nhân viên và thiết lập vị trí quản lý; React chỉ thao tác với đơn vị, vị trí và số lượng. Cutover lưu trữ slot `employee_backfill` nhưng giữ snapshot nhân viên cũ để các workflow hiện tại tiếp tục hoạt động cho tới khi từng người được phân bổ lại.

**Tech Stack:** React 18, TypeScript 5.8, Vite 6, Vitest 4, Supabase JS 2, Supabase Cloud Postgres, Tailwind utility classes.

**Spec:** `docs/superpowers/specs/2026-08-18-hrm-org-chart-workforce-planning-redesign.md`

## Global Constraints

- Không sử dụng sub-agent; thực hiện inline theo `superpowers:executing-plans` vì `AGENTS.md` cấm sub-agent.
- Mọi thao tác Supabase dùng project Cloud đã link và `.env`; không chạy Supabase local, không dùng Docker.
- Tạo migration bằng đúng hai lệnh `npx supabase migration new hrm_workforce_planning_foundation` và `npx supabase migration new hrm_workforce_planning_cutover`; không tự đặt timestamp migration.
- Không xóa cứng nhân viên, slot, vị trí hoặc lịch sử phân công.
- Không thay đổi bảng, dữ liệu hoặc công thức P3.
- Sơ đồ mặc định thu gọn và không hiển thị mã slot hoặc chữ `LEGACY` trong luồng vận hành.
- Chỉ slot nguồn `workforce_plan` được tính là định biên chính thức.
- Mỗi nhân viên có tối đa một phân bổ `PRIMARY/ACTIVE`; mỗi slot có tối đa một người giữ `PRIMARY/ACTING` đang hoạt động.
- Mỗi đơn vị có tối đa một định biên quản lý, số lượng định biên quản lý phải bằng 1; nếu trống thì tuyến duyệt đi lên đơn vị cha.
- Ngày hiệu lực phiên bản đầu phải nhỏ hơn hoặc bằng ngày hiện tại; không lập lịch tương lai.
- Giữ các trường tổ chức cũ của nhân viên làm snapshot tương thích trong giai đoạn 1; không dùng snapshot đó để hiển thị trên sơ đồ mới.
- `org_units.id` không được ghi vào `employees.construction_site_id`; chỉ đồng bộ trường này khi có khóa ánh xạ hợp lệ tới `hrm_construction_sites.id`.
- Giữ nguyên và không ghi đè các thay đổi không liên quan đang có trong worktree.

---

## File Structure

### Domain and service files

- Modify `types/hrmSharedCatalog.ts`: định nghĩa định biên gộp, kết quả RPC và tóm tắt phân bổ tổ chức.
- Modify `lib/hrmSharedCatalogModel.ts`: tổng hợp slot chính thức thành định biên và suy ra trạng thái nhân viên.
- Modify `lib/hrmSharedCatalogService.ts`: gọi các RPC định biên/phân bổ và tải dữ liệu tổ chức tối thiểu.
- Create `lib/hrmEmployeeProfileModel.ts`: tạo payload hồ sơ không chứa các trường do sơ đồ quản lý.
- Create `lib/hrmEmployeeProfileService.ts`: cập nhật hồ sơ nhân viên mà không ghi đè phân bổ tổ chức.

### UI files

- Create `components/hrm/organization/HrmOrgChartOverview.tsx`: cây tổ chức tổng quan, mặc định thu gọn.
- Create `components/hrm/organization/HrmStaffingPanel.tsx`: bảng định biên gộp của một đơn vị.
- Create `components/hrm/organization/HrmStaffingDialog.tsx`: thêm/tăng/giảm định biên.
- Create `components/hrm/organization/HrmEmployeeAssignmentDialog.tsx`: phân bổ, chuyển và gỡ nhân viên.
- Create `components/hrm/organization/HrmEmployeeOrganizationCard.tsx`: khối tổ chức chỉ đọc trong hồ sơ nhân viên.
- Modify `pages/settings/SettingsHrmSharedCatalog.tsx`: ghép hai chế độ và bỏ thao tác theo từng mã slot.
- Modify `components/hrm/EmployeeModal.tsx`: thay các select tổ chức bằng thẻ chỉ đọc.
- Modify `pages/hrm/Employees.tsx`: tải bundle tổ chức và mở dialog phân bổ dùng chung.
- Modify `context/AppContext.tsx`: cập nhật hồ sơ qua payload profile-only.

### Database and tests

- Create via CLI `supabase migration new hrm_workforce_planning_foundation`: migration RPC, index và ánh xạ công trường tùy chọn.
- Create via CLI `supabase migration new hrm_workforce_planning_cutover`: lưu trữ slot backfill sau kiểm tra tiền điều kiện.
- Create `supabase/tests/hrm_workforce_planning_smoke.sql`: smoke test Cloud có rollback.
- Create `lib/__tests__/hrmWorkforcePlanningModel.test.ts`.
- Create `lib/__tests__/hrmWorkforcePlanningMigration.test.ts`.
- Create `lib/__tests__/hrmWorkforcePlanningCutoverMigration.test.ts`.
- Modify `lib/__tests__/hrmSharedCatalogService.test.ts`.
- Create `lib/__tests__/hrmEmployeeProfileModel.test.ts`.
- Create `lib/__tests__/hrmEmployeeProfileService.test.ts`.
- Create `components/hrm/organization/__tests__/HrmStaffingPanel.test.tsx`.

---

### Task 1: Add the workforce-planning read model

**Files:**
- Modify: `types/hrmSharedCatalog.ts`
- Modify: `lib/hrmSharedCatalogModel.ts`
- Test: `lib/__tests__/hrmWorkforcePlanningModel.test.ts`

**Interfaces:**
- Produces:

```ts
export interface HrmStaffingRow {
  key: string;
  orgUnitId: string;
  positionId: string;
  levelCode: string | null;
  reportsToSlotId: string | null;
  slots: HrmOrgPositionSlot[];
  plannedCount: number;
  occupiedCount: number;
  vacantCount: number;
  isManager: boolean;
}

export interface HrmEmployeeOrganizationSummary {
  status: 'ASSIGNED' | 'PENDING';
  employeeId: string;
  assignmentId: string | null;
  slotId: string | null;
  orgUnitId: string | null;
  positionId: string | null;
  levelCode: string | null;
  managerEmployeeId: string | null;
}

export interface HrmStaffingMutationResult {
  orgUnitId: string;
  positionId: string;
  levelCode: string | null;
  reportsToSlotId: string | null;
  targetCount: number;
  occupiedCount: number;
  vacantCount: number;
}

export function buildHrmStaffingRows(
  slots: HrmOrgPositionSlot[],
  assignments: HrmEmployeeSlotAssignment[],
  units: HrmSharedOrgUnit[],
  date?: string,
): HrmStaffingRow[];

export function getHrmEmployeeOrganizationSummary(
  employeeId: string,
  slots: HrmOrgPositionSlot[],
  assignments: HrmEmployeeSlotAssignment[],
  units: HrmSharedOrgUnit[],
  date?: string,
): HrmEmployeeOrganizationSummary;
```

- [ ] **Step 1: Write failing aggregation tests**

Create tests that prove only `workforce_plan/ACTIVE` slots are counted, repeated positions are grouped, occupied/vacant counts are correct, grouping splits when reporting slots differ, and employees with no official assignment are `PENDING`.

```ts
it('groups only official active slots into business-facing staffing rows', () => {
  const rows = buildHrmStaffingRows(
    [
      slot({ id: 's1', source: 'workforce_plan', positionId: 'p1' }),
      slot({ id: 's2', source: 'workforce_plan', positionId: 'p1' }),
      slot({ id: 'legacy', source: 'employee_backfill', positionId: 'p1' }),
    ],
    [assignment({ id: 'a1', slotId: 's1', employeeId: 'e1' })],
    [unit({ id: 'u1', managerSlotId: 's1' })],
    '2026-08-18',
  );

  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    plannedCount: 2,
    occupiedCount: 1,
    vacantCount: 1,
    isManager: true,
  });
  expect(rows[0].slots.map(item => item.id)).not.toContain('legacy');
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `npx vitest run lib/__tests__/hrmWorkforcePlanningModel.test.ts`

Expected: FAIL because `HrmStaffingRow`, `buildHrmStaffingRows` and `getHrmEmployeeOrganizationSummary` do not exist.

- [ ] **Step 3: Implement the pure model**

Use the stable grouping key:

```ts
const staffingKey = (slot: HrmOrgPositionSlot) => [
  slot.orgUnitId,
  slot.positionId,
  slot.levelCode || '',
  slot.reportsToSlotId || '',
].join('|');
```

Filter slots with `source === 'workforce_plan' && status === 'ACTIVE'`. Reuse `getHrmSlotOccupancy` for the requested date. Derive `PENDING` only from the absence of an official active assignment; never inspect legacy employee profile fields for this result.

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run: `npx vitest run lib/__tests__/hrmWorkforcePlanningModel.test.ts lib/__tests__/hrmSharedCatalogModel.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the read model**

```bash
git add types/hrmSharedCatalog.ts lib/hrmSharedCatalogModel.ts lib/__tests__/hrmWorkforcePlanningModel.test.ts
git commit -m "feat: add HRM workforce planning read model"
```

---

### Task 2: Add atomic workforce-planning RPCs

**Files:**
- Create via CLI: migration whose filename ends with `_hrm_workforce_planning_foundation.sql`
- Test: `lib/__tests__/hrmWorkforcePlanningMigration.test.ts`

**Interfaces:**
- Produces these authenticated `security invoker` wrappers:

```sql
public.adjust_hrm_staffing(
  p_org_unit_id uuid,
  p_position_id uuid,
  p_level_code text,
  p_reports_to_slot_id uuid,
  p_target_count integer,
  p_note text
) returns jsonb

public.assign_hrm_employee_to_staffing(
  p_employee_id uuid,
  p_org_unit_id uuid,
  p_position_id uuid,
  p_level_code text,
  p_reports_to_slot_id uuid,
  p_effective_from date,
  p_note text
) returns jsonb

public.unassign_hrm_employee_from_organization(
  p_employee_id uuid,
  p_effective_to date,
  p_note text
) returns jsonb

public.set_hrm_unit_manager_staffing(
  p_org_unit_id uuid,
  p_position_id uuid,
  p_level_code text,
  p_reports_to_slot_id uuid
) returns jsonb
```

- Consumes existing uniqueness indexes `hrm_employee_one_active_primary_slot_idx` and `hrm_slot_one_active_occupant_idx`.

- [ ] **Step 1: Write the failing migration contract test**

Discover the migration by suffix so the test does not depend on a fabricated timestamp.

```ts
const migrationFile = readdirSync(migrationDirectory)
  .find(file => file.endsWith('_hrm_workforce_planning_foundation.sql'));

it('creates least-privilege atomic workforce planning operations', () => {
  expect(migrationFile).toBeDefined();
  expect(sql).toContain('app_private.adjust_hrm_staffing');
  expect(sql).toContain('public.adjust_hrm_staffing');
  expect(sql).toContain('security invoker');
  expect(sql).toContain('pg_advisory_xact_lock');
  expect(sql).toContain('for update skip locked');
  expect(sql).toContain("'workforce_plan'");
  expect(sql).toContain("public.is_module_admin('HRM')");
  expect(sql).not.toContain('update public.hrm_3p_bands');
});
```

- [ ] **Step 2: Run the migration test and verify RED**

Run: `npx vitest run lib/__tests__/hrmWorkforcePlanningMigration.test.ts`

Expected: FAIL because no migration with the required suffix exists.

- [ ] **Step 3: Verify current Supabase guidance before SQL implementation**

Read the current official documentation for database functions, RLS, function privileges and exposed schemas. Confirm that privileged workers remain in `app_private`, public wrappers use `security invoker`, and wrappers are granted only to `authenticated` and `service_role`.

- [ ] **Step 4: Create the migration with the CLI**

Run:

```bash
npx supabase migration new hrm_workforce_planning_foundation
FOUNDATION_MIGRATION=$(rg --files supabase/migrations | rg '_hrm_workforce_planning_foundation\.sql$' | sort | tail -1)
test -n "$FOUNDATION_MIGRATION"
```

Expected: one new empty migration path printed by the CLI and captured in `FOUNDATION_MIGRATION`.

- [ ] **Step 5: Implement the database foundation**

The migration must:

1. Add nullable `org_units.linked_construction_site_id uuid references public.hrm_construction_sites(id) on delete set null` and index it. This is the only permitted bridge to `employees.construction_site_id`.
2. Add a partial composite index for official active slot lookup:

```sql
create index if not exists hrm_workforce_plan_vacancy_idx
on public.hrm_org_position_slots (
  org_unit_id, position_id, level_code, reports_to_slot_id, id
)
where source = 'workforce_plan' and status = 'ACTIVE';
```

3. Implement workers in `app_private` with `security definer set search_path = ''` and public `security invoker` wrappers.
4. Check `public.is_admin() or public.is_module_admin('HRM')` inside every worker.
5. Reject negative target counts, future effective dates, inactive units, inactive positions and reporting cycles with stable HRM error codes.
6. Serialize changes to one staffing row using `pg_advisory_xact_lock(hashtextextended(concat_ws('|', ...), 0))`.
7. Generate hidden codes with prefix `WF-`, normalized unit/position codes and an eight-character UUID suffix; never ask the user to supply a slot code.
8. When increasing the target, insert `workforce_plan/ACTIVE` slots.
9. When decreasing, lock vacant candidates in deterministic `id` order, exclude the current manager slot, and refuse when not enough vacant slots exist.
10. When assigning, lock the employee first, then claim the first vacant target slot with `for update skip locked`; end the old primary assignment and insert the new one in the same transaction.
11. Synchronize `employees.org_unit_id`, `position_id` and `title`. Set `department_id` for department units and `factory_id` for factory units. Set `construction_site_id` only from `org_units.linked_construction_site_id`; never from `org_units.id`.
12. Keep office, employee type, salary policy, work schedule, leave and personal fields unchanged.
13. On unassign, end the official assignment but preserve compatibility snapshot fields during phase 1.
14. Permit manager selection only when the selected staffing row contains exactly one active official slot; otherwise raise `HRM_MANAGER_STAFFING_MUST_HAVE_ONE_SLOT`.
15. Write one high-impact `audit_trail` entry per mutation with old/new organization data and the supplied note.
16. Revoke public/anon execution and grant wrapper execution only to `authenticated, service_role`.

- [ ] **Step 6: Run the migration contract test and verify GREEN**

Run: `npx vitest run lib/__tests__/hrmWorkforcePlanningMigration.test.ts lib/__tests__/hrmSharedCatalogMigration.test.ts lib/__tests__/hrmManagerSlotBackfillMigration.test.ts`

Expected: PASS and no P3 SQL appears in the new migration.

- [ ] **Step 7: Commit the foundation migration**

```bash
git add "$FOUNDATION_MIGRATION" lib/__tests__/hrmWorkforcePlanningMigration.test.ts
git commit -m "feat: add atomic HRM workforce planning operations"
```

---

### Task 3: Add the workforce-planning service API

**Files:**
- Modify: `lib/hrmSharedCatalogService.ts`
- Modify: `lib/__tests__/hrmSharedCatalogService.test.ts`

**Interfaces:**
- Consumes the four RPC wrappers from Task 2.
- Produces:

```ts
adjustStaffing(input: {
  orgUnitId: string;
  positionId: string;
  levelCode?: string | null;
  reportsToSlotId?: string | null;
  targetCount: number;
  note: string;
}): Promise<HrmStaffingMutationResult>

assignEmployeeToStaffing(input: {
  employeeId: string;
  orgUnitId: string;
  positionId: string;
  levelCode?: string | null;
  reportsToSlotId?: string | null;
  effectiveFrom: string;
  note: string;
}): Promise<HrmEmployeeOrganizationSummary>

unassignEmployeeFromOrganization(input: {
  employeeId: string;
  effectiveTo: string;
  note: string;
}): Promise<HrmEmployeeOrganizationSummary>

setUnitManagerStaffing(input: {
  orgUnitId: string;
  positionId: string;
  levelCode?: string | null;
  reportsToSlotId?: string | null;
}): Promise<{ orgUnitId: string; managerSlotId: string | null }>
```

- [ ] **Step 1: Write failing RPC mapping tests**

```ts
it('adjusts staffing without exposing technical slot codes', async () => {
  rpc.mockResolvedValueOnce({
    data: { org_unit_id: 'u1', position_id: 'p1', target_count: 3, occupied_count: 1 },
    error: null,
  });

  await hrmSharedCatalogService.adjustStaffing({
    orgUnitId: 'u1', positionId: 'p1', levelCode: 'E4',
    reportsToSlotId: null, targetCount: 3, note: 'Định biên QLDA',
  });

  expect(rpc).toHaveBeenCalledWith('adjust_hrm_staffing', {
    p_org_unit_id: 'u1', p_position_id: 'p1', p_level_code: 'E4',
    p_reports_to_slot_id: null, p_target_count: 3, p_note: 'Định biên QLDA',
  });
});
```

Add equivalent tests for assign, unassign and manager selection, including Vietnamese fallback errors.

- [ ] **Step 2: Run the service test and verify RED**

Run: `npx vitest run lib/__tests__/hrmSharedCatalogService.test.ts`

Expected: FAIL because the four service methods do not exist.

- [ ] **Step 3: Implement RPC adapters and mapping**

Add `mapStaffingMutationResult` and `mapEmployeeOrganizationSummary`. Do not accept `actorId` from callers; the database must derive the actor from the authenticated session.

Add `loadOrganizationBundle()` that loads only `org_units`, `hrm_org_position_slots`, `hrm_employee_slot_assignments`, `employees` and `hrm_positions` for employee/profile screens.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `npx vitest run lib/__tests__/hrmSharedCatalogService.test.ts lib/__tests__/hrmWorkforcePlanningModel.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the service API**

```bash
git add lib/hrmSharedCatalogService.ts lib/__tests__/hrmSharedCatalogService.test.ts types/hrmSharedCatalog.ts
git commit -m "feat: expose HRM staffing service operations"
```

---

### Task 4: Build reusable organization and staffing components

**Files:**
- Create: `components/hrm/organization/HrmOrgChartOverview.tsx`
- Create: `components/hrm/organization/HrmStaffingPanel.tsx`
- Create: `components/hrm/organization/HrmStaffingDialog.tsx`
- Create: `components/hrm/organization/HrmEmployeeAssignmentDialog.tsx`
- Test: `components/hrm/organization/__tests__/HrmStaffingPanel.test.tsx`

**Interfaces:**

```ts
export interface HrmOrgChartOverviewProps {
  roots: HrmOrgTreeNode[];
  selectedUnitId: string | null;
  query: string;
  expansionCommand: { expanded: boolean; version: number };
  onSelectUnit(unit: HrmSharedOrgUnit): void;
}

export interface HrmStaffingPanelProps {
  unit: HrmSharedOrgUnit;
  rows: HrmStaffingRow[];
  positions: HrmSharedPosition[];
  canManage: boolean;
  onAdjust(row?: HrmStaffingRow): void;
  onAssign(row: HrmStaffingRow): void;
  onSetManager(row: HrmStaffingRow): void;
}
```

- [ ] **Step 1: Write a failing server-rendered component test**

Use `react-dom/server` so no new test dependency is required.

```tsx
it('renders one business row and hides legacy slot codes', () => {
  const html = renderToStaticMarkup(
    <HrmStaffingPanel
      unit={unit}
      rows={[staffingRow({ plannedCount: 11, occupiedCount: 0, vacantCount: 11 })]}
      positions={[position({ id: 'p1', name: 'Cố vấn' })]}
      canManage
      onAdjust={() => undefined}
      onAssign={() => undefined}
      onSetManager={() => undefined}
    />,
  );

  expect(html).toContain('Cố vấn');
  expect(html).toContain('0 / 11');
  expect(html).not.toContain('QLDA-LEGACY');
});
```

Also assert the overview starts collapsed and labels use `Định biên`, `Đã bố trí`, `Còn trống`, `Phân bổ nhân sự` and `Chuyển vị trí`.

- [ ] **Step 2: Run the component test and verify RED**

Run: `npx vitest run components/hrm/organization/__tests__/HrmStaffingPanel.test.tsx`

Expected: FAIL because the components do not exist.

- [ ] **Step 3: Implement the visual components**

Build the approved hybrid layout:

- Overview shows company, K1/K2/K3 and child units, default collapsed.
- Selecting a unit opens a right-side detail panel on wide screens and a stacked panel on small screens.
- The detail panel renders one row per `HrmStaffingRow`; it never renders `slot.code`.
- Empty units show `Chưa có định biên chính thức` and `Thiết lập định biên đầu tiên`.
- Staffing dialog accepts position, level, quantity, reporting position and required note.
- Reporting-position options are limited to manager rows or rows with exactly one official slot; the component maps the chosen business row to its hidden `slot.id` and never displays the ID/code.
- Assignment dialog accepts employee, destination unit, destination position, effective date and required reason.
- Disable future dates with `max={new Date().toISOString().slice(0, 10)}` and repeat validation before calling the service.
- Unassign requires confirmation and a reason.
- All database error codes are mapped to the business messages listed in the spec.

- [ ] **Step 4: Run the component and model tests and verify GREEN**

Run: `npx vitest run components/hrm/organization/__tests__/HrmStaffingPanel.test.tsx lib/__tests__/hrmWorkforcePlanningModel.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the reusable UI**

```bash
git add components/hrm/organization lib/__tests__/hrmWorkforcePlanningModel.test.ts
git commit -m "feat: add HRM organization and staffing components"
```

---

### Task 5: Replace the technical slot view in Settings

**Files:**
- Modify: `pages/settings/SettingsHrmSharedCatalog.tsx`

**Interfaces:**
- Consumes `buildHrmOrgForest`, `buildHrmStaffingRows`, the four Task 3 service methods and all Task 4 components.
- Keeps existing catalog tabs for positions, groups, levels, competencies and employee catalogs.

- [ ] **Step 1: Extend the component contract test for Settings composition**

Add a source-level assertion to the Task 4 test file that imports `SettingsHrmSharedCatalog` and server-renders the loading/empty state. Assert the page contains `Sơ đồ tổng quan` and `Định biên & nhân sự`, and does not render `+ Slot` or `Slot quản lý trực tiếp`.

- [ ] **Step 2: Run the test and verify RED**

Run: `npx vitest run components/hrm/organization/__tests__/HrmStaffingPanel.test.tsx`

Expected: FAIL because the existing settings page still exposes per-slot controls.

- [ ] **Step 3: Integrate the approved two-mode experience**

Modify `SettingsHrmSharedCatalog.tsx` to:

1. Retain `Danh mục dùng chung HRM` and all non-organization catalog views.
2. Replace `OrgTreeUnit` slot cards with `HrmOrgChartOverview` and `HrmStaffingPanel`.
3. Build official rows from `buildHrmStaffingRows`.
4. Show top-level stats based only on official rows and official active assignments.
5. Keep search and `Mở toàn bộ / Thu gọn` controls.
6. Open shared staffing/assignment dialogs for mutations, reload after success and preserve selected unit.
7. Move legacy migration details into a collapsed `Lịch sử dữ liệu cũ` section outside the main organization view.
8. Remove normal UI actions for creating, archiving or moving an individual technical slot.
9. Keep P3 text and data untouched.

- [ ] **Step 4: Run focused tests and type checking**

Run:

```bash
npx vitest run components/hrm/organization/__tests__/HrmStaffingPanel.test.tsx lib/__tests__/hrmWorkforcePlanningModel.test.ts lib/__tests__/hrmSharedCatalogService.test.ts
npm run lint
```

Expected: PASS with no TypeScript errors.

- [ ] **Step 5: Commit the Settings integration**

```bash
git add pages/settings/SettingsHrmSharedCatalog.tsx components/hrm/organization
git commit -m "feat: simplify HRM org chart around workforce plans"
```

---

### Task 6: Make organization fields read-only in employee profiles

**Files:**
- Create: `lib/hrmEmployeeProfileModel.ts`
- Create: `lib/hrmEmployeeProfileService.ts`
- Create: `lib/__tests__/hrmEmployeeProfileModel.test.ts`
- Create: `lib/__tests__/hrmEmployeeProfileService.test.ts`
- Create: `components/hrm/organization/HrmEmployeeOrganizationCard.tsx`
- Modify: `components/hrm/EmployeeModal.tsx`
- Modify: `pages/hrm/Employees.tsx`
- Modify: `context/AppContext.tsx`

**Interfaces:**

```ts
export type EmployeeProfileUpdatePayload = Pick<Employee,
  'fullName' | 'gender' | 'phone' | 'email' | 'dateOfBirth' |
  'startDate' | 'officialDate' | 'status' | 'userId' | 'areaId' |
  'officeId' | 'employeeTypeId' | 'salaryPolicyId' |
  'workScheduleId' | 'maritalStatus' | 'avatarUrl'
>;

export function toEmployeeProfileUpdatePayload(
  employee: Employee,
): Record<string, unknown>;

export const hrmEmployeeProfileService: {
  update(employee: Employee): Promise<void>;
};
```

- [ ] **Step 1: Write failing profile payload tests**

```ts
it('never writes organization-managed fields from the employee profile form', () => {
  const payload = toEmployeeProfileUpdatePayload(employee({
    orgUnitId: 'u1', positionId: 'p1', departmentId: 'd1',
    constructionSiteId: 'c1', factoryId: 'f1', title: 'Cố vấn',
  }));

  expect(payload).not.toHaveProperty('org_unit_id');
  expect(payload).not.toHaveProperty('position_id');
  expect(payload).not.toHaveProperty('department_id');
  expect(payload).not.toHaveProperty('construction_site_id');
  expect(payload).not.toHaveProperty('factory_id');
  expect(payload).not.toHaveProperty('title');
  expect(payload).toMatchObject({ full_name: 'Nguyễn A' });
});
```

Mock Supabase and verify `hrmEmployeeProfileService.update` sends only this payload with `.eq('id', employee.id)`.

- [ ] **Step 2: Run profile tests and verify RED**

Run: `npx vitest run lib/__tests__/hrmEmployeeProfileModel.test.ts lib/__tests__/hrmEmployeeProfileService.test.ts`

Expected: FAIL because the model and service do not exist.

- [ ] **Step 3: Implement profile-only persistence**

Create the mapper and service. Update `AppContext.updateEmployee` to call `hrmEmployeeProfileService.update(e)` rather than the generic employee branch in `syncToSupabase`. Preserve local state and audit behavior.

Keep `addEmployee` creating personal/master fields only; a new employee starts `PENDING` until assigned through the organization flow. Prevent Excel import updates from changing organization-managed fields by routing them through the same service.

- [ ] **Step 4: Replace editable organization selectors**

In `EmployeeModal.tsx`, remove editable selects for position, organization, department, construction site and factory. Render `HrmEmployeeOrganizationCard` with:

- `Đã phân bổ` or `Chờ phân bổ` from official assignments.
- Unit, position, level, group and direct manager when assigned.
- A `Phân bổ / Chuyển vị trí` button for HRM managers.

Remove the standalone editable `Chức danh` input as well. A newly created unassigned employee has no current title; assignment writes the title from the approved position.

In `Employees.tsx`, load `loadOrganizationBundle()` once when opening the admin modal, pass the summary to the card, and open the shared `HrmEmployeeAssignmentDialog` when the button is pressed. Reload employees and organization data after a successful mutation.

- [ ] **Step 5: Run profile, service and type tests and verify GREEN**

Run:

```bash
npx vitest run lib/__tests__/hrmEmployeeProfileModel.test.ts lib/__tests__/hrmEmployeeProfileService.test.ts lib/__tests__/hrmSharedCatalogService.test.ts
npm run lint
```

Expected: PASS and the profile mapper never includes organization-managed columns.

- [ ] **Step 6: Commit employee profile integration**

```bash
git add lib/hrmEmployeeProfileModel.ts lib/hrmEmployeeProfileService.ts lib/__tests__/hrmEmployeeProfileModel.test.ts lib/__tests__/hrmEmployeeProfileService.test.ts components/hrm/organization/HrmEmployeeOrganizationCard.tsx components/hrm/EmployeeModal.tsx pages/hrm/Employees.tsx context/AppContext.tsx
git commit -m "feat: manage employee organization through staffing assignments"
```

---

### Task 7: Add the safe phase-one cutover migration

**Files:**
- Create via CLI: migration whose filename ends with `_hrm_workforce_planning_cutover.sql`
- Test: `lib/__tests__/hrmWorkforcePlanningCutoverMigration.test.ts`

**Interfaces:**
- Consumes tables and functions already deployed by the existing HRM migrations.
- Produces zero active `employee_backfill` slots without deleting history or modifying employee compatibility fields.

- [ ] **Step 1: Write the failing cutover contract test**

```ts
it('archives backfill slots only after proving they are unoccupied', () => {
  expect(migrationFile).toBeDefined();
  expect(sql).toContain("source = 'employee_backfill'");
  expect(sql).toContain("status = 'ARCHIVED'");
  expect(sql).toContain('HRM_CUTOVER_ACTIVE_BACKFILL_ASSIGNMENTS');
  expect(sql).toContain('manager_slot_id = null');
  expect(sql).not.toContain('delete from public.hrm_org_position_slots');
  expect(sql).not.toContain('update public.employees');
  expect(sql).not.toContain('hrm_3p');
});
```

- [ ] **Step 2: Run the cutover test and verify RED**

Run: `npx vitest run lib/__tests__/hrmWorkforcePlanningCutoverMigration.test.ts`

Expected: FAIL because the cutover migration does not exist.

- [ ] **Step 3: Create the cutover migration with the CLI**

```bash
npx supabase migration new hrm_workforce_planning_cutover
CUTOVER_MIGRATION=$(rg --files supabase/migrations | rg '_hrm_workforce_planning_cutover\.sql$' | sort | tail -1)
test -n "$CUTOVER_MIGRATION"
```

- [ ] **Step 4: Implement the idempotent cutover**

The migration must run in one transaction and:

1. Count active/planned assignments joined to `employee_backfill` slots; raise `HRM_CUTOVER_ACTIVE_BACKFILL_ASSIGNMENTS` if the count is not zero.
2. Clear `org_units.manager_slot_id` only where it points to an `employee_backfill` slot.
3. Update those slots to `ARCHIVED`, set `effective_to = greatest(effective_from, current_date)` and update timestamps.
4. Preserve all `hrm_employee_slot_assignments` rows and all employee columns.
5. Add one aggregate audit record containing archived count and cutover timestamp.
6. Leave all `workforce_plan` slots and every P3 table untouched.

- [ ] **Step 5: Run cutover and existing migration tests**

Run:

```bash
npx vitest run lib/__tests__/hrmWorkforcePlanningCutoverMigration.test.ts lib/__tests__/hrmWorkforcePlanningMigration.test.ts lib/__tests__/hrmSharedCatalogMigration.test.ts lib/__tests__/hrmManagerSlotBackfillMigration.test.ts lib/__tests__/hrmLegacyPositionMigration.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit the cutover migration**

```bash
git add "$CUTOVER_MIGRATION" lib/__tests__/hrmWorkforcePlanningCutoverMigration.test.ts
git commit -m "feat: archive legacy HRM backfill slots safely"
```

---

### Task 8: Add Cloud smoke coverage and complete the cutover

**Files:**
- Create: `supabase/tests/hrm_workforce_planning_smoke.sql`
- Modify if needed: `package.json`

**Interfaces:**
- Consumes all Task 2 and Task 7 database operations.
- Produces repeatable Cloud-only verification with all test mutations rolled back.

- [ ] **Step 1: Write the smoke transaction**

Create a SQL file that:

1. Starts `begin` and sets a short local statement timeout.
2. Selects one active org unit and one approved active position into temporary test variables.
3. Uses a test transaction-local admin identity compatible with existing test patterns.
4. Calls `adjust_hrm_staffing` to create target count 2.
5. Verifies two `workforce_plan/ACTIVE` slots exist and no technical code is required by the RPC input.
6. Assigns one active employee and verifies official assignment plus synchronized `org_unit_id/position_id`.
7. Verifies reducing target to zero fails while occupied.
8. Unassigns the employee, reduces target to zero and verifies both slots become archived.
9. Creates a one-slot manager staffing row, selects it as manager and verifies direct-manager fallback semantics.
10. Ends with `rollback` so no smoke data persists.

- [ ] **Step 2: Add a Cloud-only package script**

```json
"smoke:hrm-workforce": "npx supabase db query --linked --agent=no --file supabase/tests/hrm_workforce_planning_smoke.sql"
```

- [ ] **Step 3: Run the complete local verification before touching Cloud schema**

Run:

```bash
npm run lint
npm test
npm run build
git diff --check
```

Expected: TypeScript PASS, all Vitest suites PASS, production build PASS, no whitespace errors. Existing Vite chunk-size warnings are acceptable; new errors are not.

- [ ] **Step 4: Inspect linked migration history and dry-run the push**

Run:

```bash
npx supabase migration list --linked
npx supabase db push --linked --dry-run
```

Expected: only the two new workforce-planning migrations are pending. If any older migration is pending or histories diverge, stop and reconcile history before applying anything; do not use `--include-all` automatically.

- [ ] **Step 5: Compile both migrations in a Cloud rollback transaction**

Create a temporary combined SQL file outside the repository, strip the inner transaction wrappers, and wrap both migrations in one rollback transaction:

```bash
FOUNDATION_MIGRATION=$(rg --files supabase/migrations | rg '_hrm_workforce_planning_foundation\.sql$' | sort | tail -1)
CUTOVER_MIGRATION=$(rg --files supabase/migrations | rg '_hrm_workforce_planning_cutover\.sql$' | sort | tail -1)
DRY_RUN_SQL=$(mktemp)
printf 'begin;\nset local statement_timeout = '\''30s'\'';\n' > "$DRY_RUN_SQL"
sed -E '/^[[:space:]]*(begin|commit);[[:space:]]*$/Id' "$FOUNDATION_MIGRATION" >> "$DRY_RUN_SQL"
sed -E '/^[[:space:]]*(begin|commit);[[:space:]]*$/Id' "$CUTOVER_MIGRATION" >> "$DRY_RUN_SQL"
printf '\nrollback;\n' >> "$DRY_RUN_SQL"
npx supabase db query --linked --agent=no --file "$DRY_RUN_SQL"
```

Expected: success, zero persistent schema/data changes, and no function/RLS error.

- [ ] **Step 6: Apply the linked Cloud migrations**

Run: `npx supabase db push --linked`

Expected: exactly the two reviewed migrations are applied and recorded in `supabase_migrations.schema_migrations`.

- [ ] **Step 7: Run Cloud advisors and smoke test**

Run:

```bash
npx supabase db advisors --linked --type security --level warn
npx supabase db advisors --linked --type performance --level warn
npm run smoke:hrm-workforce
```

Expected: no new security warning, no missing index caused by this feature, smoke transaction PASS and rollback.

- [ ] **Step 8: Verify the real cutover state**

Run a read-only linked query and assert:

```sql
select
  count(*) filter (where source = 'employee_backfill' and status = 'ACTIVE') as active_backfill_slots,
  count(*) filter (where source = 'workforce_plan' and status = 'ACTIVE') as official_slots
from public.hrm_org_position_slots;
```

Expected immediately after cutover: `active_backfill_slots = 0`, `official_slots = 0`. Also verify active official assignments are 0, ended assignment history is preserved, active employee profile count is unchanged, and P3 row counts equal their pre-cutover snapshot.

- [ ] **Step 9: Perform visual and regression QA**

Start the app and verify:

- Organization tree loads collapsed.
- No `LEGACY` or technical slot code appears in the main organization view.
- Selecting QLDA shows zero official staffing and the setup call-to-action.
- Creating staffing shows one grouped row, not repeated cards.
- Assigning and moving an employee updates Settings and the employee profile card.
- Workflow recipient selection, employee directory, 3D org map, employee dashboard and project member creation still read compatible employee fields without runtime errors.
- Employee profile edits cannot change organization or position directly.

- [ ] **Step 10: Run final verification and commit smoke coverage**

Invoke `superpowers:verification-before-completion`, then run fresh:

```bash
npm run lint
npm test
npm run build
git diff --check
```

Commit:

```bash
git add supabase/tests/hrm_workforce_planning_smoke.sql package.json
git commit -m "test: cover HRM workforce planning cutover"
```

Expected: all checks PASS and the handoff reports exact Cloud counts and any pre-existing warnings separately.

---

## Phase-Two Exit Gate

This plan intentionally stops after the safe phase-one cutover. Do not remove employee compatibility columns or rewrite all consumers in this execution. Create a separate phase-two plan only when all conditions are true:

- No active employee remains `PENDING` in the official assignment source.
- Workflow, directory, 3D org map, dashboard and project screens have an approved replacement read path.
- A Cloud query proves no production function/view still depends on the legacy employee organization columns.
- The user approves removal or deprecation after reviewing an impact report.
