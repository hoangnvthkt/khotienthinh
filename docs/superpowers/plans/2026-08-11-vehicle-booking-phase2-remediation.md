# Vehicle Booking Phase 2 Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sửa Phase 2 Booking theo đúng thứ tự review để các luồng chính hoạt động với Supabase Cloud và có regression coverage.

**Architecture:** Frontend permission registry kiểm soát route; `vehicleBookingService.ts` là contract boundary; page chỉ gọi API đã typed. Migration mới loại bỏ drift và bổ sung enforcement backend, còn read helpers cung cấp đúng queue cho từng vai trò.

**Tech Stack:** React 19, TypeScript, Vitest, Supabase JS/Postgres/RLS/Storage/Realtime, Vite.

## Global Constraints

- Supabase Cloud only qua cấu hình `.env`; không local, không Docker.
- Không dùng sub-agent theo `AGENTS.md`.
- TDD cho mọi bugfix; chạy test đỏ trước production edit.
- Không stage `supabase/.temp/cli-latest`.

---

### Task 1: Permission registry và migration history

**Files:**
- Modify: `lib/permissions/permissionRegistry.ts`
- Rename/modify: `supabase/migrations/20260812000005_vehicle_booking_routes.sql` thành version migration kế tiếp
- Test: `lib/__tests__/permissionRouteRegistry.test.ts`
- Test: `lib/__tests__/vehicleBookingPermissionRegistry.test.ts`

**Interfaces:**
- Produces: `system.vehicle_booking.view/manage` và mười route được `canAccessRoute` nhận diện.

- [ ] Viết test người dùng có `allowedModules: ['VEHICLE_BOOKING']` truy cập được `/booking/vehicle/my`, người không có module bị chặn.
- [ ] Chạy test và xác nhận đỏ do registry thiếu module.
- [ ] Thêm label/sort key `VEHICLE_BOOKING`; chạy lại test xanh.
- [ ] Đổi migration sang version mới duy nhất; thêm revoke/grant và enforcement override.
- [ ] Áp dụng lên Cloud, kiểm tra migration history và RPC signature.

### Task 2: Contract test và sửa đủ 25 RPC

**Files:**
- Modify: `lib/vehicleBookingService.ts`
- Create: `lib/__tests__/vehicleBookingServiceContract.test.ts`

**Interfaces:**
- Produces: 25 wrapper có payload trùng `pg_get_function_identity_arguments` trên Cloud.

- [ ] Tạo Supabase boundary fake ghi nhận `.rpc(name, args)` và test các payload sai đã phát hiện.
- [ ] Chạy test đỏ cho reject, dispatch, reassign, respond, checkpoint, external complete, feedback, cancel, no-show, authorization và unavailability cancellation.
- [ ] Sửa tên/kiểu tham số tối thiểu, bổ sung reason/override input typed.
- [ ] Chạy contract test xanh và đối chiếu tự động danh sách 25 tên RPC.

### Task 3: Dispatch, driver response và handover queues

**Files:**
- Modify: `lib/vehicleBookingService.ts`
- Modify: `pages/booking/DispatcherWorkbenchPage.tsx`
- Modify: `pages/booking/DriverTodayTripsPage.tsx`
- Modify: `pages/booking/VehicleHandoverPage.tsx`
- Test: `lib/__tests__/vehicleBookingOperationalQueries.test.ts`
- Test: `pages/booking/__tests__/vehicleBookingWorkflowContracts.test.tsx`

**Interfaces:**
- Produces: `fetchDriverTodayAssignments`, `fetchVehicleHandoverQueue`, dispatch payload có `override_reason`.

- [ ] Viết test đỏ cho lọc ngày Việt Nam, booking ID khi phản hồi, queue self-drive và override bắt buộc.
- [ ] Sửa fetcher/page theo state machine backend.
- [ ] Thêm Realtime subscription cho booking/assignment/profile với cleanup, giữ polling fallback.
- [ ] Tính trạng thái xe/tài xế từ availability, custody, overlap và unavailability; không hiển thị mặc định “Rảnh”.
- [ ] Chạy test task xanh.

### Task 4: Evidence, GPS, timezone và image size

**Files:**
- Modify: `lib/vehicleBookingService.ts`
- Modify: `pages/booking/VehicleBookingCreatePage.tsx`
- Modify: `pages/booking/TripExecutionModal.tsx`
- Test: `lib/__tests__/vehicleBookingTimeAndEvidence.test.ts`

**Interfaces:**
- Produces: `vietnamLocalDateTimeToISOString`, `compressImageWithinLimit`, client validation evidence.

- [ ] Viết test đỏ với timezone process khác Việt Nam và literal ISO kỳ vọng.
- [ ] Viết test đỏ cho thiếu ảnh, thiếu GPS/failure reason và blob vượt max.
- [ ] Triển khai conversion UTC+7 cố định, validation trước RPC và compression lặp có hậu kiểm.
- [ ] Đọc `max_evidence_image_mb` thay vì hardcode 5 MB.
- [ ] Chạy test task xanh.

### Task 5: Fleet Settings và master data safety

**Files:**
- Modify: `pages/booking/FleetManagementPage.tsx`
- Modify: `lib/vehicleBookingService.ts`
- Modify: `pages/booking/VehicleBookingLayout.tsx`
- Test: `pages/booking/__tests__/vehicleBookingFleetSettings.test.tsx`

**Interfaces:**
- Produces: form giữ đủ chín settings, vehicle update giữ home base, navigation theo permission.

- [ ] Viết test đỏ chứng minh save bốn field làm mất năm field còn lại và vehicle update gửi home base null.
- [ ] Hiển thị/lưu đủ chín settings từ state Cloud.
- [ ] Giữ `home_base_id`, bỏ raw tham số authorization không có trong RPC.
- [ ] Ẩn tab nhạy cảm theo `booking.vehicle.*` grants.
- [ ] Chạy test task xanh.

### Task 6: Luồng còn thiếu và kiểm chứng tổng

**Files:**
- Modify/create dưới `pages/booking/` khi cần cho external completion, feedback, participants.
- Modify: `VehicleBookingLayout.tsx`, `Sidebar.tsx`, `UserModal.tsx` nếu route được triển khai.
- Test: `pages/booking/__tests__/vehicleBookingPilotJourneys.test.tsx`

**Interfaces:**
- Produces: pilot journeys internal driver, self-drive, external transport hoàn chỉnh.

- [ ] Viết test hành trình đỏ cho ba fulfillment types.
- [ ] Bổ sung UI tối thiểu còn thiếu để kết thúc từng hành trình.
- [ ] Chạy `npm run lint`, `npm run build`, `npx vitest run --exclude '.worktrees/**'`.
- [ ] Chạy Cloud smoke test, migration history, advisor và kiểm tra Realtime publication.
- [ ] Review `git diff --check` và chỉ commit các file thuộc Booking/permission liên quan.
