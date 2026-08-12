# Vehicle Booking Phase 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hoàn thiện Phase 3 của Booking gồm KPI vận hành, xuất báo cáo, đánh giá và xử lý phản ánh nhạy cảm, audit timeline có phân quyền, cùng deep-link notification đúng luồng hiện hữu.

**Architecture:** PostgreSQL/Supabase Cloud là nguồn tính toán và enforcement duy nhất cho KPI, issues và audit; frontend chỉ gọi các RPC typed và không truy vấn bảng nhạy cảm trực tiếp. Notification tiếp tục được xử lý bởi worker `pg_cron` hiện có, còn React sử dụng bảng `notifications` và Realtime hiện hữu để hiển thị thông báo; Phase 3 không tạo worker hoặc đưa `service_role` vào trình duyệt.

**Tech Stack:** React 18.2, TypeScript 5.8, React Router 6.22, Recharts 2.12, SheetJS `xlsx` 0.18.5, Vitest 4, Supabase JS 2.98, Supabase Cloud PostgreSQL/RLS/Realtime/pg_cron.

## Global Constraints

- Chỉ dùng Supabase Cloud qua cấu hình `.env`; không dùng Supabase local và không dùng Docker.
- Không dùng sub-agent theo `AGENTS.md`; khi thực thi plan phải dùng `superpowers:executing-plans` inline.
- Không sửa migration lịch sử `20260812000001` đến `20260812000011`; mọi thay đổi database là migration cộng thêm từ `20260812000012`.
- TDD cho từng contract/bugfix: viết test đỏ, xác nhận đúng lý do đỏ, sửa tối thiểu, chạy xanh rồi mới commit.
- Khoảng thời gian báo cáo luôn là nửa mở `[from_at, to_at)` và hiển thị theo `Asia/Ho_Chi_Minh`; RPC nhận `timestamptz` UTC.
- Không đưa nội dung `vehicle_booking_issues.comment` hoặc `resolution_note` vào `audit_trail`, notification payload, console log hoặc file export.
- Không có báo cáo theo dự án và không có KPI nhiên liệu trong Phase 3 vì `vehicle_bookings` chưa có project snapshot và chưa có dữ liệu nhiên liệu.
- Không tạo `lib/vehicleBookingNotificationWorker.ts`, không gọi claim/deliver outbox từ frontend và không để `service_role` trong bundle.
- Không thêm dependency mới; dùng `recharts`, `xlsx`, `file-saver` và `lib/loadXlsx.ts` đã có.
- Không stage `supabase/.temp/cli-latest`; không đưa file này vào bất kỳ commit nào.

---

## Scope và tiêu chí nghiệp vụ đã khóa

### Công thức KPI

| KPI | Tử số / Giá trị | Mẫu số / Phạm vi |
|---|---|---|
| Chuyến hoàn thành | Booking có `status = 'COMPLETED'` | `requested_pickup_at` nằm trong `[from_at, to_at)` |
| Đúng giờ | Chuyến nội bộ có `actual_pickup_at <= requested_pickup_at + on_time_tolerance_minutes` | Chỉ chuyến nội bộ hoàn thành có `actual_pickup_at`; xe ngoài bị loại khỏi mẫu số |
| Hủy sát giờ | Booking có `close_reason = 'LATE_CANCELLED'` | Booking đã submit, tức `status <> 'DRAFT'`, có `requested_pickup_at` trong kỳ |
| Công suất xe | Tổng phút giao giữa `[departed_home_base_at, actual_return_at hoặc min(now(), to_at))` và kỳ báo cáo | Tổng phút của các xe nội bộ `active = true` hiện tại trừ phút `vehicle_unavailability_periods` giao với kỳ |
| Quãng đường | Tổng `vehicle_trip_logs.distance_km` của trip `FINISHED` | Nhóm theo `vehicle_asset_id_snapshot`, hiển thị `assets.code/name` |
| Chi phí xe ngoài | Tổng `external_actual_cost`, không dùng estimated cost | Booking hoàn thành, assignment active có `fulfillment_type = 'EXTERNAL_TRANSPORT'`, nhóm theo `department_id_snapshot` |

Khi lọc theo phòng ban, tử số công suất chỉ gồm chuyến của phòng ban đó nhưng mẫu số vẫn là năng lực đội xe toàn công ty; UI phải ghi rõ đây là “mức sử dụng năng lực đội xe bởi phòng ban”. Do chưa có lịch sử trạng thái `fleet_vehicle_profiles.active`, công suất quá khứ dùng trạng thái active hiện tại và phải có chú thích trong dashboard/export.

### Phạm vi giao hàng

- **Release 3A — Data & Security:** permission, RLS, RPC contracts, Cloud smoke fixtures.
- **Release 3B — Analytics:** dashboard, bộ lọc kỳ báo cáo, Excel/CSV.
- **Release 3C — Feedback & Issues:** mở rộng modal hiện có, inbox phản ánh, state transition phía server.
- **Release 3D — Audit & Notification UX:** timeline đã redaction, sửa deep-link, tích hợp route/navigation.

Không bắt đầu Release kế tiếp nếu test contract của Release trước chưa xanh. Toàn bộ migration chỉ được đẩy lên Cloud tại Task 10, sau khi migration `00014` đã hoàn thiện qua Tasks 5–7.

## File map

### Tạo mới

- `types/vehicleBookingPhase3.ts`: toàn bộ type của analytics, issues, audit và cursor.
- `lib/vehicleBookingAnalyticsService.ts`: preset thời gian và hai RPC analytics/export.
- `lib/vehicleBookingAnalyticsExport.ts`: chuyển dữ liệu export thành workbook/CSV, không gọi Supabase.
- `lib/vehicleBookingIssueService.ts`: list issues và command transition.
- `lib/vehicleBookingAuditService.ts`: lấy audit timeline theo cursor.
- `pages/booking/VehicleBookingAnalyticsPage.tsx`: KPI cards, charts, bảng cost, filter và export.
- `pages/booking/VehicleBookingIssuesPage.tsx`: hàng đợi phản ánh, chi tiết và hành động xử lý.
- `pages/booking/VehicleBookingAuditTrailPage.tsx`: timeline vận hành có filter/cursor.
- `supabase/migrations/20260812000012_vehicle_booking_phase3_security.sql`: permission, RLS issues, audit grant containment.
- `supabase/migrations/20260812000013_vehicle_booking_phase3_analytics.sql`: indexes và analytics/export RPC.
- `supabase/migrations/20260812000014_vehicle_booking_phase3_operations.sql`: feedback validation, issues workflow và audit RPC.
- `supabase/migrations/20260812000015_vehicle_booking_phase3_notification_links.sql`: canonical notification link trong worker hiện có.
- `supabase/tests/vehicle_booking_phase3_smoke.sql`: golden fixtures, permission matrix và RPC smoke có rollback.
- Các test Vitest được nêu cụ thể trong từng task.

### Sửa hiện hữu

- `constants/routes.ts`: thêm `/booking/vehicle/issues` và `/booking/vehicle/audit`.
- `types.ts`: export lại types Phase 3.
- `lib/vehicleBookingPermissions.ts`: helper quyền reports/issues/audit và scope phòng ban.
- `lib/notificationRoutes.ts`: canonical hóa notification `vehicle_booking` cũ và mới.
- `pages/booking/VehicleFeedbackModal.tsx`: giữ modal hiện hữu, đổi tags thành lựa chọn ổn định và bổ sung luồng phản ánh.
- `pages/booking/MyVehicleBookingsPage.tsx`: mở booking từ query `?booking={bookingId}`.
- `pages/booking/VehicleBookingLayout.tsx`: khai báo route/tab và route guard theo permission.
- `components/Sidebar.tsx`, `components/UserModal.tsx`: thêm navigation Phase 3 và ẩn đúng quyền.
- `package.json`: thêm script `smoke:vehicle-booking-phase3`.
- `lib/__tests__/vehicleBookingPermissionRegistry.test.ts`: cập nhật route registry expectation.

---

### Task 1: Release 3A — Permission và security contract

**Files:**
- Create: `supabase/migrations/20260812000012_vehicle_booking_phase3_security.sql`
- Modify: `constants/routes.ts`
- Modify: `lib/vehicleBookingPermissions.ts`
- Test: `lib/__tests__/vehicleBookingPhase3SecurityContract.test.ts`
- Test: `lib/__tests__/vehicleBookingPermissionRegistry.test.ts`
- Test: `lib/__tests__/vehicleBookingPermissionsPhase3.test.ts`

**Interfaces:**
- Produces: permissions `booking.vehicle.view_reports`, `booking.vehicle.view_sensitive_feedback`, `booking.vehicle.resolve_sensitive_feedback`, `booking.vehicle.view_audit`.
- Produces: `canViewVehicleReports(user)`, `canViewSensitiveVehicleIssues(user)`, `canResolveSensitiveVehicleIssues(user)`, `canViewVehicleAudit(user)`.
- Produces: protected routes `/booking/vehicle/reports`, `/booking/vehicle/issues`, `/booking/vehicle/audit`.

- [ ] **Step 1: Viết test đỏ cho route và permission helpers**

  Cập nhật expected routes theo đúng thứ tự sau và kiểm tra `booking.vehicle.admin` vẫn thừa hưởng tất cả quyền:

  ```ts
  expect(module?.routes).toEqual([
    '/booking/vehicle',
    '/booking/vehicle/my',
    '/booking/vehicle/approvals',
    '/booking/vehicle/dispatch',
    '/booking/vehicle/trips',
    '/booking/vehicle/handover',
    '/booking/vehicle/fleet',
    '/booking/vehicle/drivers',
    '/booking/vehicle/reports',
    '/booking/vehicle/issues',
    '/booking/vehicle/audit',
    '/booking/vehicle/settings',
  ]);
  ```

  Test riêng bốn trường hợp: không grant, grant hết hạn, grant đúng code, `booking.vehicle.admin`.

- [ ] **Step 2: Chạy test và xác nhận đỏ do thiếu hai route/helper**

  Run:

  ```bash
  npx vitest run lib/__tests__/vehicleBookingPermissionRegistry.test.ts lib/__tests__/vehicleBookingPermissionsPhase3.test.ts
  ```

  Expected: route list chưa có `issues/audit` và các helper chưa được export.

- [ ] **Step 3: Thêm route và helper frontend tối thiểu**

  Dùng helper sẵn có để tránh thêm logic role cứng:

  ```ts
  export const canViewVehicleReports = (user: Pick<User, 'permissionGrants'> | null | undefined) =>
    hasActiveVehicleBookingGrant(user, ['booking.vehicle.view_reports']);

  export const canViewSensitiveVehicleIssues = (user: Pick<User, 'permissionGrants'> | null | undefined) =>
    hasActiveVehicleBookingGrant(user, ['booking.vehicle.view_sensitive_feedback']);

  export const canResolveSensitiveVehicleIssues = (user: Pick<User, 'permissionGrants'> | null | undefined) =>
    hasActiveVehicleBookingGrant(user, ['booking.vehicle.resolve_sensitive_feedback']);

  export const canViewVehicleAudit = (user: Pick<User, 'permissionGrants'> | null | undefined) =>
    hasActiveVehicleBookingGrant(user, ['booking.vehicle.view_audit']);
  ```

- [ ] **Step 4: Viết migration security cộng thêm**

  Migration phải thực hiện đủ các thay đổi sau trong một transaction:

  ```sql
  begin;

  update public.permission_modules
  set routes = array[
    '/booking/vehicle', '/booking/vehicle/my', '/booking/vehicle/approvals',
    '/booking/vehicle/dispatch', '/booking/vehicle/trips', '/booking/vehicle/handover',
    '/booking/vehicle/fleet', '/booking/vehicle/drivers', '/booking/vehicle/reports',
    '/booking/vehicle/issues', '/booking/vehicle/audit', '/booking/vehicle/settings'
  ]::text[], updated_at = now()
  where code = 'resource_booking.vehicle';

  insert into public.permission_actions
    (module_code, action, permission_code, label, scope_modes, legacy_module_key, legacy_route, legacy_admin_only, sort_order)
  values
    ('resource_booking.vehicle', 'resolve_sensitive_feedback',
     'booking.vehicle.resolve_sensitive_feedback', 'Xử lý phản ánh nhạy cảm',
     array['global']::text[], 'VEHICLE_BOOKING', '/booking/vehicle/issues', true, 105),
    ('resource_booking.vehicle', 'view_audit',
     'booking.vehicle.view_audit', 'Xem lịch sử vận hành đặt xe',
     array['global', 'department']::text[], 'VEHICLE_BOOKING', '/booking/vehicle/audit', false, 108)
  on conflict (permission_code) do update set
    label = excluded.label,
    scope_modes = excluded.scope_modes,
    legacy_route = excluded.legacy_route,
    legacy_admin_only = excluded.legacy_admin_only,
    sort_order = excluded.sort_order,
    updated_at = now();

  update public.permission_actions
  set legacy_route = '/booking/vehicle/issues', updated_at = now()
  where permission_code = 'booking.vehicle.view_sensitive_feedback';

  revoke select, insert, update, delete, truncate on public.audit_trail from anon;
  revoke update, delete, truncate on public.audit_trail from authenticated;

  commit;
  ```

  Thay `app_private.vehicle_user_can_view_issue` để chỉ trả `true` cho reporter hoặc explicit `view_sensitive_feedback/admin`; bỏ quyền đọc full comment ngầm định của dispatcher, fleet manager và manager snapshot.

- [ ] **Step 5: Viết migration contract test**

  Test đọc file SQL và assert có hai permission mới, có `revoke` audit, không grant issue mutation cho `authenticated`, không chứa `booking.vehicle.dispatch` trong thân hàm `vehicle_user_can_view_issue`.

- [ ] **Step 6: Chạy test Task 1 và commit**

  ```bash
  npx vitest run lib/__tests__/vehicleBookingPermissionRegistry.test.ts lib/__tests__/vehicleBookingPermissionsPhase3.test.ts lib/__tests__/vehicleBookingPhase3SecurityContract.test.ts
  git add constants/routes.ts lib/vehicleBookingPermissions.ts lib/__tests__/vehicleBookingPermissionRegistry.test.ts lib/__tests__/vehicleBookingPermissionsPhase3.test.ts lib/__tests__/vehicleBookingPhase3SecurityContract.test.ts supabase/migrations/20260812000012_vehicle_booking_phase3_security.sql
  git commit -m "feat: define vehicle booking phase3 security contract"
  ```

---

### Task 2: Release 3A — Analytics RPC và golden fixtures

**Files:**
- Create: `supabase/migrations/20260812000013_vehicle_booking_phase3_analytics.sql`
- Create: `supabase/tests/vehicle_booking_phase3_smoke.sql`
- Modify: `package.json`
- Test: `lib/__tests__/vehicleBookingPhase3AnalyticsMigration.test.ts`

**Interfaces:**
- Produces: `public.get_vehicle_booking_analytics(p_from_at timestamptz, p_to_at timestamptz, p_department_id uuid default null) returns jsonb`.
- Produces: `public.export_vehicle_booking_analytics(p_from_at timestamptz, p_to_at timestamptz, p_department_id uuid default null)` với table contract được khóa tại Step 6.
- Consumes: `app_private.vehicle_user_has_scoped_permission(uuid, text, text, text)`.

- [ ] **Step 1: Viết test đỏ cho SQL contract analytics**

  Assert file migration phải có `security definer`, `set search_path = ''`, half-open predicates, explicit revoke/grant và không dùng `external_estimated_cost`:

  ```ts
  expect(sql).toContain("requested_pickup_at >= p_from_at");
  expect(sql).toContain("requested_pickup_at < p_to_at");
  expect(sql).not.toContain('sum(external_estimated_cost)');
  expect(sql).toContain('revoke all on function public.get_vehicle_booking_analytics');
  expect(sql).toContain('grant execute on function public.get_vehicle_booking_analytics');
  ```

- [ ] **Step 2: Chạy test và xác nhận đỏ do migration chưa tồn tại**

  ```bash
  npx vitest run lib/__tests__/vehicleBookingPhase3AnalyticsMigration.test.ts
  ```

- [ ] **Step 3: Tạo indexes phục vụ report**

  Thêm đúng các index không phá dữ liệu:

  ```sql
  create index if not exists idx_vehicle_bookings_reporting_window
    on public.vehicle_bookings(requested_pickup_at, department_id_snapshot, status);
  create index if not exists idx_vehicle_trip_logs_reporting
    on public.vehicle_trip_logs(departed_home_base_at, actual_return_at, trip_status);
  create index if not exists idx_vehicle_assignments_external_cost
    on public.vehicle_booking_assignments(booking_id, fulfillment_type)
    where is_active and fulfillment_type = 'EXTERNAL_TRANSPORT';
  create index if not exists idx_vehicle_unavailability_reporting
    on public.vehicle_unavailability_periods(vehicle_asset_id, start_at, end_at);
  ```

- [ ] **Step 4: Triển khai permission gate dùng scope**

  Cả hai RPC phải gọi cùng rule:

  ```sql
  if p_from_at is null or p_to_at is null or p_to_at <= p_from_at then
    raise exception using errcode = '22023', message = 'INVALID_REPORTING_PERIOD';
  end if;

  if p_department_id is null then
    if not app_private.vehicle_user_has_scoped_permission(
      public.current_app_user_id(), 'booking.vehicle.view_reports', 'global', '*'
    ) then
      perform app_private.vehicle_raise_permission_denied('Global report permission required');
    end if;
  elsif not (
    app_private.vehicle_user_has_scoped_permission(
      public.current_app_user_id(), 'booking.vehicle.view_reports', 'global', '*'
    ) or app_private.vehicle_user_has_scoped_permission(
      public.current_app_user_id(), 'booking.vehicle.view_reports', 'department', p_department_id::text
    )
  ) then
    perform app_private.vehicle_raise_permission_denied('Department report permission required');
  end if;
  ```

- [ ] **Step 5: Triển khai payload analytics đúng công thức đã khóa**

  JSON contract phải giữ nguyên camelCase sau:

  ```json
  {
    "period": { "fromAt": "2026-07-31T17:00:00.000Z", "toAt": "2026-08-31T17:00:00.000Z", "timeZone": "Asia/Ho_Chi_Minh" },
    "scope": { "departmentId": null, "capacityDenominator": "CURRENT_ACTIVE_COMPANY_FLEET" },
    "kpis": {
      "completedTrips": 0,
      "onTimeEligibleTrips": 0,
      "onTimeTrips": 0,
      "onTimeRate": null,
      "submittedBookings": 0,
      "lateCancelledBookings": 0,
      "lateCancellationRate": null,
      "usedVehicleMinutes": 0,
      "availableVehicleMinutes": 0,
      "vehicleUtilizationRate": null
    },
    "distanceByVehicle": [],
    "fulfillmentBreakdown": [],
    "externalCostByDepartment": []
  }
  ```

  Trả rate `null` khi mẫu số bằng 0, không trả `NaN`, chuỗi hoặc số âm. Join `public.assets` để trả `vehicleCode/vehicleName`, join `public.org_units` để trả `departmentName`; khi snapshot null dùng `Chưa xác định`.

- [ ] **Step 6: Triển khai export RPC với cột ổn định**

  Return table phải có đúng thứ tự:

  ```sql
  returns table (
    booking_id uuid,
    booking_code text,
    department_id uuid,
    department_name text,
    requested_pickup_at timestamptz,
    actual_pickup_at timestamptz,
    actual_return_at timestamptz,
    fulfillment_type text,
    vehicle_code text,
    vehicle_name text,
    distance_km numeric,
    external_actual_cost numeric,
    status text,
    close_reason text,
    is_on_time boolean
  )
  ```

  `is_on_time` là null cho external transport hoặc row không có actual pickup.

- [ ] **Step 7: Viết Cloud smoke fixture có rollback**

  `supabase/tests/vehicle_booking_phase3_smoke.sql` phải:

  1. `begin;` và kết thúc `rollback;`.
  2. Tạo actor global report, actor department report và actor không quyền bằng email có prefix `phase3-smoke-`.
  3. Tạo một xe active, một khoảng unavailable 60 phút, hai chuyến nội bộ đúng/muộn, một chuyến external có actual cost và một late cancellation quanh mốc UTC tương ứng Việt Nam.
  4. Assert chính xác counts/rates/minutes/cost bằng các block `do` có `raise exception 'PHASE3_ANALYTICS_ASSERTION_FAILED'` khi giá trị khác expected.
  5. Assert actor phòng A không truy vấn được phòng B, actor không quyền nhận `42501/P0001` permission denied.
  6. Assert export không có comment/resolution note.

- [ ] **Step 8: Thêm script, chạy test và commit**

  ```json
  "smoke:vehicle-booking-phase3": "npx --yes supabase@2.110.0 db query --linked --file supabase/tests/vehicle_booking_phase3_smoke.sql"
  ```

  ```bash
  npx vitest run lib/__tests__/vehicleBookingPhase3AnalyticsMigration.test.ts
  git add package.json supabase/migrations/20260812000013_vehicle_booking_phase3_analytics.sql supabase/tests/vehicle_booking_phase3_smoke.sql lib/__tests__/vehicleBookingPhase3AnalyticsMigration.test.ts
  git commit -m "feat: add scoped vehicle booking analytics RPCs"
  ```

---

### Task 3: Release 3B — TypeScript analytics contract và period presets

**Files:**
- Create: `types/vehicleBookingPhase3.ts`
- Modify: `types.ts`
- Create: `lib/vehicleBookingAnalyticsService.ts`
- Test: `lib/__tests__/vehicleBookingAnalyticsService.test.ts`
- Test: `lib/__tests__/vehicleBookingReportingPeriod.test.ts`

**Interfaces:**
- Produces: `VehicleBookingAnalytics`, `VehicleBookingAnalyticsExportRow`, `VehicleBookingReportingPeriod`.
- Produces: `fetchVehicleBookingAnalytics(period, departmentId?)`.
- Produces: `fetchVehicleBookingAnalyticsExport(period, departmentId?)`.
- Produces: `buildVehicleBookingReportingPeriod(preset, now?)` và `buildVehicleBookingCustomReportingPeriod(fromDate, toDateInclusive)`.

- [ ] **Step 1: Khai báo test đỏ cho exact RPC payload**

  ```ts
  await fetchVehicleBookingAnalytics(
    { fromAt: '2026-07-31T17:00:00.000Z', toAt: '2026-08-31T17:00:00.000Z' },
    'department-1',
  );
  expect(rpc).toHaveBeenCalledWith('get_vehicle_booking_analytics', {
    p_from_at: '2026-07-31T17:00:00.000Z',
    p_to_at: '2026-08-31T17:00:00.000Z',
    p_department_id: 'department-1',
  });
  ```

  Test error propagation và normalize arrays rỗng/rate null.

- [ ] **Step 2: Viết test timezone cho tuần/tháng/quý Việt Nam**

  Với `now = 2026-08-12T03:00:00.000Z`, kỳ tháng phải là:

  ```ts
  expect(buildVehicleBookingReportingPeriod('THIS_MONTH', now)).toEqual({
    fromAt: '2026-07-31T17:00:00.000Z',
    toAt: '2026-08-31T17:00:00.000Z',
  });
  ```

  Tuần bắt đầu thứ Hai 00:00 Việt Nam; quý bắt đầu ngày 1 của tháng 1/4/7/10; `toAt` luôn là đầu kỳ kế tiếp.

- [ ] **Step 3: Chạy test đỏ**

  ```bash
  npx vitest run lib/__tests__/vehicleBookingAnalyticsService.test.ts lib/__tests__/vehicleBookingReportingPeriod.test.ts
  ```

- [ ] **Step 4: Tạo type contract**

  ```ts
  export type VehicleBookingReportingPeriod = { fromAt: string; toAt: string };
  export type VehicleBookingReportPreset = 'THIS_WEEK' | 'THIS_MONTH' | 'THIS_QUARTER';

  export interface VehicleBookingAnalytics {
    period: VehicleBookingReportingPeriod & { timeZone: 'Asia/Ho_Chi_Minh' };
    scope: { departmentId: string | null; capacityDenominator: 'CURRENT_ACTIVE_COMPANY_FLEET' };
    kpis: {
      completedTrips: number;
      onTimeEligibleTrips: number;
      onTimeTrips: number;
      onTimeRate: number | null;
      submittedBookings: number;
      lateCancelledBookings: number;
      lateCancellationRate: number | null;
      usedVehicleMinutes: number;
      availableVehicleMinutes: number;
      vehicleUtilizationRate: number | null;
    };
    distanceByVehicle: Array<{ vehicleAssetId: string; vehicleCode: string; vehicleName: string; distanceKm: number; tripCount: number }>;
    fulfillmentBreakdown: Array<{ fulfillmentType: 'INTERNAL_WITH_DRIVER' | 'INTERNAL_SELF_DRIVE' | 'EXTERNAL_TRANSPORT'; tripCount: number }>;
    externalCostByDepartment: Array<{ departmentId: string | null; departmentName: string; actualCost: number; tripCount: number }>;
  }

  export interface VehicleBookingAnalyticsExportRow {
    bookingId: string;
    bookingCode: string;
    departmentId: string | null;
    departmentName: string;
    requestedPickupAt: string;
    actualPickupAt: string | null;
    actualReturnAt: string | null;
    fulfillmentType: 'INTERNAL_WITH_DRIVER' | 'INTERNAL_SELF_DRIVE' | 'EXTERNAL_TRANSPORT' | null;
    vehicleCode: string | null;
    vehicleName: string | null;
    distanceKm: number | null;
    externalActualCost: number | null;
    status: string;
    closeReason: string | null;
    isOnTime: boolean | null;
  }
  ```

- [ ] **Step 5: Implement service và preset tối thiểu**

  Validate `toAt > fromAt` trước RPC. Tách phép dựng ngày Việt Nam thành pure functions, không phụ thuộc timezone của máy chạy test; không dùng `new Date(year, month, day)` theo local timezone. Custom range nhận hai chuỗi `YYYY-MM-DD`, đặt `fromAt` tại 00:00 ngày đầu và `toAt` tại 00:00 ngày sau `toDateInclusive` theo giờ Việt Nam.

- [ ] **Step 6: Chạy test xanh và commit**

  ```bash
  npx vitest run lib/__tests__/vehicleBookingAnalyticsService.test.ts lib/__tests__/vehicleBookingReportingPeriod.test.ts
  git add types.ts types/vehicleBookingPhase3.ts lib/vehicleBookingAnalyticsService.ts lib/__tests__/vehicleBookingAnalyticsService.test.ts lib/__tests__/vehicleBookingReportingPeriod.test.ts
  git commit -m "feat: add vehicle booking analytics client contract"
  ```

---

### Task 4: Release 3B — Dashboard và Excel/CSV export

**Files:**
- Create: `lib/vehicleBookingAnalyticsExport.ts`
- Create: `pages/booking/VehicleBookingAnalyticsPage.tsx`
- Test: `lib/__tests__/vehicleBookingAnalyticsExport.test.ts`
- Test: `pages/booking/__tests__/vehicleBookingAnalyticsViewModel.test.ts`

**Interfaces:**
- Consumes: `fetchVehicleBookingAnalytics`, `fetchVehicleBookingAnalyticsExport` từ Task 3.
- Produces: `buildVehicleBookingAnalyticsWorkbook(rows, period)`.
- Produces: `buildVehicleBookingAnalyticsCsv(rows)`.
- Produces: default component `VehicleBookingAnalyticsPage`.

- [ ] **Step 1: Viết test đỏ cho export không rò rỉ dữ liệu nhạy cảm**

  Test workbook có sheet `Tong hop` và `Chi tiet`; header chi tiết đúng thứ tự tiếng Việt; không có key `comment`, `resolutionNote`, `issueCategory`. Test CSV giữ UTF-8 BOM để Excel mở tiếng Việt đúng.

- [ ] **Step 2: Chạy test đỏ**

  ```bash
  npx vitest run lib/__tests__/vehicleBookingAnalyticsExport.test.ts pages/booking/__tests__/vehicleBookingAnalyticsViewModel.test.ts
  ```

- [ ] **Step 3: Implement export pure và lazy-load SheetJS**

  `buildVehicleBookingAnalyticsWorkbook` nhận dữ liệu đã fetch, không gọi Supabase. Nút XLSX mới gọi `loadXlsx()` và `saveAs`; nút CSV dùng `Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' })`. Tên file:

  ```ts
  `bao-cao-booking-xe_${fromDate}_${toDateExclusive}.xlsx`
  `bao-cao-booking-xe_${fromDate}_${toDateExclusive}.csv`
  ```

- [ ] **Step 4: Tạo view model formatter có test**

  Rate null hiển thị `—`, rate số hiển thị tối đa một chữ số thập phân, tiền dùng `vi-VN/VND`, km dùng một chữ số thập phân. Tooltip on-time phải hiển thị `onTimeTrips/onTimeEligibleTrips`.

- [ ] **Step 5: Tạo dashboard page**

  Page gồm:

  1. Filter preset Tuần/Tháng/Quý và custom date range.
  2. Department selector chỉ hiện các department scope lấy từ `user.permissionGrants`; user chỉ có một scope được chọn sẵn và không có lựa chọn toàn công ty.
  3. Bốn KPI cards theo payload server.
  4. Bar chart `distanceByVehicle`.
  5. Donut chart `fulfillmentBreakdown`.
  6. Bảng `externalCostByDepartment`.
  7. Loading skeleton, empty state và error state có nút thử lại.
  8. Chú thích denominator công suất và giới hạn lịch sử active vehicle.
  9. Hai nút XLSX/CSV disable trong lúc fetch/export.

- [ ] **Step 6: Chạy test task, lint và commit**

  ```bash
  npx vitest run lib/__tests__/vehicleBookingAnalyticsExport.test.ts pages/booking/__tests__/vehicleBookingAnalyticsViewModel.test.ts
  npm run lint
  git add lib/vehicleBookingAnalyticsExport.ts pages/booking/VehicleBookingAnalyticsPage.tsx lib/__tests__/vehicleBookingAnalyticsExport.test.ts pages/booking/__tests__/vehicleBookingAnalyticsViewModel.test.ts
  git commit -m "feat: add vehicle booking KPI dashboard and export"
  ```

---

### Task 5: Release 3C — Feedback contract và modal hiện hữu

**Files:**
- Create: `supabase/migrations/20260812000014_vehicle_booking_phase3_operations.sql`
- Modify: `pages/booking/VehicleFeedbackModal.tsx`
- Test: `lib/__tests__/vehicleBookingFeedbackPhase3Contract.test.ts`
- Test: `pages/booking/__tests__/vehicleBookingFeedbackModel.test.ts`

**Interfaces:**
- Consumes: public RPC `submit_vehicle_feedback` hiện có, giữ nguyên argument names.
- Produces: rating 1–5 được lưu cho cả feedback thường và issue.
- Produces: stable tags `CLEAN_VEHICLE`, `COURTEOUS_DRIVER`, `ON_TIME`, `SAFE_DRIVING`.
- Produces: issue categories `SAFETY`, `DRIVER_CONDUCT`, `VEHICLE_CONDITION`, `SERVICE_DELAY`, `COST`, `OTHER`.

- [ ] **Step 1: Viết test đỏ cho validation model**

  Tách validation/payload builder pure khỏi component và test:

  ```ts
  expect(buildVehicleFeedbackPayload({
    bookingId: '11111111-1111-4111-8111-111111111111',
    rating: 2,
    hasIssue: false,
    positiveTags: [],
    issueCategory: null,
    comment: '',
  }))
    .toEqual({ ok: false, message: 'Vui lòng mô tả phản ánh cho đánh giá từ 3 sao trở xuống.' });

  expect(buildVehicleFeedbackPayload({
    bookingId: '11111111-1111-4111-8111-111111111111',
    rating: 5,
    hasIssue: false,
    positiveTags: ['ON_TIME', 'SAFE_DRIVING'],
    issueCategory: null,
    comment: '',
  })).toMatchObject({
    ok: true,
    value: { is_issue: false, rating: 5, positive_tags: ['ON_TIME', 'SAFE_DRIVING'] },
  });
  ```

  Rule UI: rating 1–3 tự bật issue; rating 4–5 vẫn cho phép bật issue thủ công. Issue luôn cần category và comment không trắng, tối đa 4.000 ký tự.

- [ ] **Step 2: Chạy test đỏ và xác nhận command hiện không lưu rating khi issue**

  ```bash
  npx vitest run lib/__tests__/vehicleBookingFeedbackPhase3Contract.test.ts pages/booking/__tests__/vehicleBookingFeedbackModel.test.ts
  ```

- [ ] **Step 3: Cập nhật command trong migration operations**

  `app_private.command_submit_vehicle_feedback` phải validate rating 1–5 ở mọi nhánh, validate allowlist tag/category, lưu `rating` và `positive_tags` kể cả `ISSUE_REPORTED`. Audit chỉ ghi status, rating, issue id/category; tuyệt đối không ghi comment.

  ```sql
  if p_rating is null or p_rating not between 1 and 5 then
    raise exception using errcode = '22023', message = 'RATING_REQUIRED';
  end if;
  if p_is_issue and length(trim(coalesce(p_comment, ''))) not between 1 and 4000 then
    raise exception using errcode = '22023', message = 'ISSUE_COMMENT_INVALID';
  end if;
  ```

- [ ] **Step 4: Mở rộng `VehicleFeedbackModal.tsx`, không tạo modal thứ hai**

  Thay input tags phân cách dấu phẩy bằng bốn checkbox/chip có mã ổn định. Luôn hiển thị star selector; issue form xuất hiện tự động ở 1–3 sao hoặc khi người dùng chọn “Gửi phản ánh riêng”. Thêm dòng cam kết “Nội dung chỉ hiển thị cho người có quyền xử lý phản ánh”.

- [ ] **Step 5: Chạy tests và commit phần feedback của migration cùng UI**

  ```bash
  npx vitest run lib/__tests__/vehicleBookingFeedbackPhase3Contract.test.ts pages/booking/__tests__/vehicleBookingFeedbackModel.test.ts lib/__tests__/vehicleBookingServiceContract.test.ts
  git add supabase/migrations/20260812000014_vehicle_booking_phase3_operations.sql pages/booking/VehicleFeedbackModal.tsx lib/__tests__/vehicleBookingFeedbackPhase3Contract.test.ts pages/booking/__tests__/vehicleBookingFeedbackModel.test.ts
  git commit -m "feat: strengthen vehicle booking feedback capture"
  ```

---

### Task 6: Release 3C — Sensitive issues inbox và transition RPC

**Files:**
- Modify: `supabase/migrations/20260812000014_vehicle_booking_phase3_operations.sql`
- Modify: `types/vehicleBookingPhase3.ts`
- Create: `lib/vehicleBookingIssueService.ts`
- Create: `pages/booking/VehicleBookingIssuesPage.tsx`
- Test: `lib/__tests__/vehicleBookingIssueService.test.ts`
- Test: `pages/booking/__tests__/vehicleBookingIssueWorkflow.test.ts`

**Interfaces:**
- Produces: `public.get_vehicle_booking_issues(p_status text default null, p_limit integer default 50, p_cursor_created_at timestamptz default null, p_cursor_id uuid default null) returns jsonb`.
- Produces: `public.transition_vehicle_booking_issue(p_issue_id uuid, p_target_status text, p_resolution_note text default null) returns jsonb`.
- Produces: `fetchVehicleBookingIssues(filter)` và `transitionVehicleBookingIssue(input)`.

- [ ] **Step 1: Viết test đỏ cho RPC payload và state machine**

  State machine duy nhất được chấp nhận:

  ```text
  PENDING -> IN_REVIEW
  IN_REVIEW -> RESOLVED
  IN_REVIEW -> DISMISSED
  ```

  `RESOLVED/DISMISSED` cần resolution note từ 1 đến 4.000 ký tự. Lặp lại cùng target trên issue đã final trả kết quả idempotent; mọi transition khác trả `INVALID_ISSUE_TRANSITION`.

- [ ] **Step 2: Chạy test đỏ**

  ```bash
  npx vitest run lib/__tests__/vehicleBookingIssueService.test.ts pages/booking/__tests__/vehicleBookingIssueWorkflow.test.ts
  ```

- [ ] **Step 3: Implement list RPC bảo vệ full content**

  `get_vehicle_booking_issues` chỉ cho explicit `booking.vehicle.view_sensitive_feedback/admin`, không dùng direct table query ở page. Return contract:

  ```ts
  type VehicleBookingIssuePage = {
    items: Array<{
      id: string;
      bookingId: string;
      bookingCode: string;
      reporterUserId: string;
      reporterName: string;
      departmentName: string | null;
      issueCategory: string;
      comment: string;
      rating: number | null;
      resolutionStatus: 'PENDING' | 'IN_REVIEW' | 'RESOLVED' | 'DISMISSED';
      resolutionNote: string | null;
      resolvedByName: string | null;
      resolvedAt: string | null;
      createdAt: string;
    }>;
    nextCursor: { createdAt: string; id: string } | null;
  };
  ```

  Dùng keyset pagination `(created_at, id) < (cursor_created_at, cursor_id)`, clamp `p_limit` trong 1–100.

- [ ] **Step 4: Implement transition command**

  Lock issue `for update`; require `booking.vehicle.resolve_sensitive_feedback/admin`; update resolver fields; khi final thì set feedback của booking thành `RESOLVED`. Ghi audit đã redaction và enqueue `ISSUE_RESOLVED` cho reporter với payload chỉ có `booking_id`, `booking_code`, `resolution_status`.

- [ ] **Step 5: Implement typed service và page**

  Page có status tabs, category badge, booking code, reporter, department, created time, detail drawer và pagination. Chỉ render buttons transition nếu `canResolveSensitiveVehicleIssues(user)`; user chỉ có view được đọc nhưng không có mutation controls. Không lưu issue text trong URL/localStorage.

- [ ] **Step 6: Chạy tests và commit**

  ```bash
  npx vitest run lib/__tests__/vehicleBookingIssueService.test.ts pages/booking/__tests__/vehicleBookingIssueWorkflow.test.ts lib/__tests__/vehicleBookingFeedbackPhase3Contract.test.ts
  git add supabase/migrations/20260812000014_vehicle_booking_phase3_operations.sql lib/vehicleBookingIssueService.ts pages/booking/VehicleBookingIssuesPage.tsx lib/__tests__/vehicleBookingIssueService.test.ts pages/booking/__tests__/vehicleBookingIssueWorkflow.test.ts
  git commit -m "feat: add secure vehicle booking issue workflow"
  ```

---

### Task 7: Release 3D — Scoped audit timeline

**Files:**
- Modify: `supabase/migrations/20260812000014_vehicle_booking_phase3_operations.sql`
- Modify: `types/vehicleBookingPhase3.ts`
- Create: `lib/vehicleBookingAuditService.ts`
- Create: `pages/booking/VehicleBookingAuditTrailPage.tsx`
- Test: `lib/__tests__/vehicleBookingAuditService.test.ts`
- Test: `lib/__tests__/vehicleBookingAuditRedaction.test.ts`

**Interfaces:**
- Produces: `public.get_vehicle_booking_audit_timeline(p_booking_id uuid default null, p_department_id uuid default null, p_event_type text default null, p_from_at timestamptz default null, p_to_at timestamptz default null, p_limit integer default 50, p_cursor_occurred_at timestamptz default null, p_cursor_id text default null) returns jsonb`.
- Produces: `fetchVehicleBookingAuditTimeline(filter)`.

- [ ] **Step 1: Viết test đỏ cho RPC args, cursor và redaction**

  Test kết quả frontend map đúng ba source types và fixture chứa chuỗi bí mật trong issue không xuất hiện ở JSON timeline:

  ```ts
  type VehicleBookingAuditEvent = {
    id: string;
    bookingId: string;
    bookingCode: string;
    occurredAt: string;
    sourceType: 'BOOKING_EVENT' | 'ASSIGNMENT_VERSION' | 'HANDOVER';
    eventType: string;
    title: string;
    actorName: string | null;
    summary: string;
    details: Record<string, string | number | boolean | null>;
  };
  ```

- [ ] **Step 2: Chạy test đỏ**

  ```bash
  npx vitest run lib/__tests__/vehicleBookingAuditService.test.ts lib/__tests__/vehicleBookingAuditRedaction.test.ts
  ```

- [ ] **Step 3: Implement scoped audit RPC**

  Permission rule giống analytics nhưng dùng `booking.vehicle.view_audit`. Nếu có `p_booking_id`, lấy `department_id_snapshot` của booking để kiểm tra scope; nếu list toàn cục với department-scoped grant thì bắt buộc `p_department_id` đúng scope.

  Union ba nguồn:

  - `audit_trail` với `module = 'VEHICLE_BOOKING'`, chỉ expose `action`, `description`, actor và allowlisted status/rating/issue category từ JSON.
  - `vehicle_booking_assignments`, expose version, fulfillment type, vehicle/operator, assigned/superseded timestamps và `supersede_reason`.
  - `vehicle_handover_logs`, expose event type, officer, `confirmed_on_behalf`, `override_reason`, note.

  Không select `vehicle_booking_issues` trong RPC. Pagination dùng `(occurred_at, synthetic_id)` giảm dần và return `{ items, nextCursor }`.

- [ ] **Step 4: Implement service và page timeline**

  Page có filter kỳ, department, event type và optional booking UUID từ `?booking=`. Render từng event với icon/color theo source type; details là allowlist label, không render raw JSON. Nút “Tải thêm” dùng cursor, không dùng offset.

- [ ] **Step 5: Chạy test và commit**

  ```bash
  npx vitest run lib/__tests__/vehicleBookingAuditService.test.ts lib/__tests__/vehicleBookingAuditRedaction.test.ts
  git add supabase/migrations/20260812000014_vehicle_booking_phase3_operations.sql lib/vehicleBookingAuditService.ts pages/booking/VehicleBookingAuditTrailPage.tsx lib/__tests__/vehicleBookingAuditService.test.ts lib/__tests__/vehicleBookingAuditRedaction.test.ts
  git commit -m "feat: add scoped vehicle booking audit timeline"
  ```

---

### Task 8: Release 3D — Notification deep-link và mở booking từ URL

**Files:**
- Create: `supabase/migrations/20260812000015_vehicle_booking_phase3_notification_links.sql`
- Modify: `lib/notificationRoutes.ts`
- Modify: `pages/booking/MyVehicleBookingsPage.tsx`
- Test: `lib/__tests__/vehicleBookingNotificationRoutes.test.ts`
- Test: `pages/booking/__tests__/vehicleBookingDeepLink.test.ts`

**Interfaces:**
- Produces: canonical link `/booking/vehicle/my?booking={bookingId}`.
- Consumes: Realtime subscription hiện có trong `lib/notificationService.ts` và `components/NotificationCenter.tsx`; không tạo subscription thứ hai.

- [ ] **Step 1: Viết test đỏ cho notification cũ và mới**

  ```ts
  expect(resolveNotificationPath({
    sourceType: 'vehicle_booking',
    sourceId: 'booking-1',
    link: '/booking/vehicles/booking-1',
    metadata: {},
  } as AppNotification)).toBe('/booking/vehicle/my?booking=booking-1');

  expect(resolveNotificationPath({
    sourceType: 'vehicle_booking',
    metadata: { booking_id: 'booking-2' },
  } as AppNotification)).toBe('/booking/vehicle/my?booking=booking-2');
  ```

  Test deep-link model chỉ auto-open khi UUID/query id tồn tại trong danh sách user được phép xem; query không hợp lệ hiển thị toast và được xóa khỏi URL.

- [ ] **Step 2: Chạy test đỏ**

  ```bash
  npx vitest run lib/__tests__/vehicleBookingNotificationRoutes.test.ts pages/booking/__tests__/vehicleBookingDeepLink.test.ts
  ```

- [ ] **Step 3: Sửa worker DB hiện có bằng migration cộng thêm**

  `create or replace` cả `app_private.deliver_vehicle_notification(uuid)` và `app_private.process_vehicle_notification_outbox(integer)` để mọi `link/action_url` dùng:

  ```sql
  '/booking/vehicle/my?booking=' || coalesce(v_booking.id::text, v_outbox.payload ->> 'booking_id')
  ```

  Giữ nguyên `FOR UPDATE SKIP LOCKED`, retry/stale-lock recovery, unique event key, grants chỉ `service_role` và lịch pg_cron hiện có. Bổ sung title `ISSUE_RESOLVED` nhưng body không chứa comment/resolution note.

- [ ] **Step 4: Canonicalize frontend và mở detail**

  Đặt nhánh `vehicle_booking` trong `resolveNotificationPath` trước fallback. Trong `MyVehicleBookingsPage`, đọc `useSearchParams`, fetch booking qua service/RLS hiện hữu, mở detail nếu được phép, rồi giữ query để refresh vẫn mở đúng; khi modal đóng thì xóa riêng param `booking` mà không xóa param khác.

- [ ] **Step 5: Chạy tests và commit**

  ```bash
  npx vitest run lib/__tests__/vehicleBookingNotificationRoutes.test.ts pages/booking/__tests__/vehicleBookingDeepLink.test.ts
  git add supabase/migrations/20260812000015_vehicle_booking_phase3_notification_links.sql lib/notificationRoutes.ts pages/booking/MyVehicleBookingsPage.tsx lib/__tests__/vehicleBookingNotificationRoutes.test.ts pages/booking/__tests__/vehicleBookingDeepLink.test.ts
  git commit -m "fix: route vehicle booking notifications to accessible details"
  ```

---

### Task 9: Route, navigation và permission-aware integration

**Files:**
- Modify: `pages/booking/VehicleBookingLayout.tsx`
- Modify: `components/Sidebar.tsx`
- Modify: `components/UserModal.tsx`
- Test: `pages/booking/__tests__/vehicleBookingPhase3Navigation.test.ts`
- Test: `lib/__tests__/vehicleBookingPermissionRegistry.test.ts`

**Interfaces:**
- Consumes: ba page mặc định từ Tasks 4, 6, 7 và permission helpers từ Task 1.
- Produces: route guards nhất quán ở layout, sidebar và user permission modal.

- [ ] **Step 1: Viết test đỏ cho visibility matrix**

  Matrix bắt buộc:

  | Grant | Reports | Issues | Audit |
  |---|---:|---:|---:|
  | Không grant | Ẩn/chặn | Ẩn/chặn | Ẩn/chặn |
  | `view_reports` | Hiện | Ẩn | Ẩn |
  | `view_sensitive_feedback` | Ẩn | Hiện read-only | Ẩn |
  | `resolve_sensitive_feedback` | Ẩn | Không tự cấp quyền xem | Ẩn |
  | `view_audit` | Ẩn | Ẩn | Hiện |
  | `admin` | Hiện | Hiện + xử lý | Hiện |

  User cần cả view và resolve để page issues hiện mutation controls; backend vẫn kiểm tra từng RPC độc lập.

- [ ] **Step 2: Chạy test đỏ**

  ```bash
  npx vitest run pages/booking/__tests__/vehicleBookingPhase3Navigation.test.ts lib/__tests__/vehicleBookingPermissionRegistry.test.ts
  ```

- [ ] **Step 3: Thêm imports/routes/tabs trong layout**

  ```tsx
  <Route path="reports" element={canViewReports ? <VehicleBookingAnalyticsPage /> : <Navigate to="/booking/vehicle/my" replace />} />
  <Route path="issues" element={canViewIssues ? <VehicleBookingIssuesPage /> : <Navigate to="/booking/vehicle/my" replace />} />
  <Route path="audit" element={canViewAudit ? <VehicleBookingAuditTrailPage /> : <Navigate to="/booking/vehicle/my" replace />} />
  ```

  Tab labels: `Báo cáo & KPI`, `Phản ánh`, `Lịch sử vận hành`.

- [ ] **Step 4: Đồng bộ Sidebar và UserModal**

  Thêm đúng ba route/label và áp dụng cùng helper permission trong filter. Không dùng `Role.ADMIN` hoặc tên phòng ban để quyết định access; mọi access dựa trên active permission grants.

- [ ] **Step 5: Chạy test task, lint và commit**

  ```bash
  npx vitest run pages/booking/__tests__/vehicleBookingPhase3Navigation.test.ts lib/__tests__/vehicleBookingPermissionRegistry.test.ts
  npm run lint
  git add pages/booking/VehicleBookingLayout.tsx components/Sidebar.tsx components/UserModal.tsx pages/booking/__tests__/vehicleBookingPhase3Navigation.test.ts lib/__tests__/vehicleBookingPermissionRegistry.test.ts
  git commit -m "feat: expose permission-aware vehicle booking phase3 routes"
  ```

---

### Task 10: Supabase Cloud rollout và verification gate

**Files:**
- Verify: `supabase/migrations/20260812000012_vehicle_booking_phase3_security.sql`
- Verify: `supabase/migrations/20260812000013_vehicle_booking_phase3_analytics.sql`
- Verify: `supabase/migrations/20260812000014_vehicle_booking_phase3_operations.sql`
- Verify: `supabase/migrations/20260812000015_vehicle_booking_phase3_notification_links.sql`
- Verify: `supabase/tests/vehicle_booking_phase3_smoke.sql`
- Verify: all Phase 3 frontend/backend tests.

**Interfaces:**
- Produces: migration history đồng bộ local/Cloud, Cloud smoke xanh, build production xanh và evidence để review.

- [ ] **Step 1: Chạy full local verification trước khi push DB**

  ```bash
  npx vitest run --exclude '.worktrees/**'
  npm run lint
  npm run build
  git diff --check
  git status --short
  ```

  Expected: tất cả command exit 0; `supabase/.temp/cli-latest` có thể dirty nhưng không được stage.

- [ ] **Step 2: Kiểm tra linked project và migration history trên Cloud**

  ```bash
  npx --yes supabase@2.110.0 projects list
  npx --yes supabase@2.110.0 migration list --linked
  ```

  Xác nhận latest Cloud trước push là `20260812000011`; nếu Cloud có migration mới không nằm trong worktree thì dừng rollout và đối chiếu trước khi tiếp tục.

- [ ] **Step 3: Push bốn migration theo thứ tự**

  ```bash
  npx --yes supabase@2.110.0 db push --linked
  npx --yes supabase@2.110.0 migration list --linked
  ```

  Expected: `00012`, `00013`, `00014`, `00015` xuất hiện cả Local và Remote.

- [ ] **Step 4: Chạy Cloud smoke và Phase 1 regression smoke**

  ```bash
  npm run smoke:vehicle-booking-phase3
  npx --yes supabase@2.110.0 db query --linked --file supabase/tests/vehicle_booking_phase1_smoke.sql
  ```

  Expected: cả hai rollback sạch và không có assertion exception.

- [ ] **Step 5: Kiểm tra grants, cron và Realtime bằng Cloud SQL read-only**

  Assert:

  - `authenticated` chỉ execute public Phase 3 RPCs, không execute các private claim/deliver functions.
  - `service_role` vẫn execute claim/deliver/fail/process outbox.
  - cron job `vehicle-booking-notification-outbox` vẫn active và schedule không đổi.
  - `notifications` vẫn thuộc publication Realtime.
  - `anon` không có quyền đọc/mutate `audit_trail`; `authenticated` không có update/delete/truncate.

- [ ] **Step 6: Chạy manual pilot journeys trên build production**

  ```bash
  npm run preview -- --host 127.0.0.1
  ```

  Kiểm tra lần lượt:

  1. User global report xem company dashboard/export.
  2. User department report chỉ xem đúng department.
  3. User thường không mở được reports/issues/audit bằng URL trực tiếp.
  4. Requester gửi 5 sao và gửi 2 sao kèm issue.
  5. Viewer nhạy cảm đọc issue nhưng không xử lý; resolver chuyển PENDING → IN_REVIEW → RESOLVED.
  6. Audit page có assignment versions/handover nhưng không có issue comment.
  7. Notification mới và notification cũ đều mở `/booking/vehicle/my?booking={bookingId}`.
  8. Reload deep-link vẫn mở booking; đóng detail chỉ xóa query `booking`.

- [ ] **Step 7: Final repository review**

  ```bash
  git status --short
  git log --oneline -12
  git diff --stat HEAD~8..HEAD
  ```

  Không tạo commit tổng nếu tree sạch. Nếu chỉ còn `supabase/.temp/cli-latest`, giữ nguyên file ngoài staging và ghi rõ trong báo cáo bàn giao.

---

## Definition of Done

- 4 KPI khớp golden fixtures và không tính ở browser.
- Filter global/department bị enforce ở cả UI và RPC; bypass UI không đọc được dữ liệu ngoài scope.
- XLSX/CSV chỉ chứa cột báo cáo đã định nghĩa, không có dữ liệu issue.
- Modal feedback hiện hữu ghi được rating/tags và issue theo validation mới.
- Full issue comment chỉ đến từ RPC có `view_sensitive_feedback`; transition chỉ qua RPC có `resolve_sensitive_feedback`.
- Audit timeline không đọc raw `audit_trail` từ page và không trả raw old/new JSON.
- Không có frontend notification worker; pg_cron worker giữ idempotency/concurrency semantics.
- Deep-link notification mở đúng booking qua route người dùng được phép truy cập.
- Full Vitest, TypeScript, build, Cloud Phase 3 smoke và Phase 1 regression smoke đều xanh.

## Explicitly Out of Scope

- Web Push đến service worker/browser OS; Phase 3 chỉ hoàn thiện in-app notification + Realtime hiện có.
- Báo cáo chi phí theo dự án cho đến khi booking có immutable `project_id_snapshot`.
- KPI tiêu hao nhiên liệu cho đến khi có fuel ledger/odometer source được kiểm soát.
- Thay toàn bộ cơ chế `audit_trail` của các module khác; Phase 3 chỉ chặn anon/mutation và dùng scoped RPC cho Booking.
- Historical fleet-active capacity chính xác trước khi có bảng lịch sử trạng thái xe.
