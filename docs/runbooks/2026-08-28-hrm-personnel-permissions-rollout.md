# HRM Personnel Permissions Rollout Runbook

## Trạng thái triển khai

- Nhánh nguồn: `feature/hrm-personnel-permissions`.
- Các migration HRM từ `20260828084500` đến `20260828105200` được apply riêng lên Supabase Cloud liên kết và ghi nhận đúng từng version; không dùng Supabase local, Docker hoặc `db push --include-all`.
- Raw table access cho hồ sơ, hợp đồng, lương, payroll và tài liệu nhạy cảm đã bị thu hồi. Frontend chỉ đọc qua projection RPC và ghi qua command RPC có kiểm quyền.
- Permission Health không còn Critical HRM finding. Cổng `direct_reports` vẫn tắt vì manager readiness chưa đạt: 45 nhân sự active, 3 primary assignment hợp lệ, 42 thiếu assignment và 20 đơn vị chưa có manager hợp lệ tại thời điểm cutover.
- Security/Performance Advisor không có finding mức Error. Cảnh báo `SECURITY DEFINER` của HRM là bề mặt RPC được thiết kế có chủ đích; mỗi RPC phải tự ràng buộc actor, action, scope, subject và audit. Không allowlist cảnh báo trong Permission Health.
- Frontend production không thuộc thao tác của runbook này. Sau Cloud cutover, phải phát hành đúng build từ nhánh đã qua kiểm thử trước khi cho người dùng vận hành HRM.

## Cấp hoặc thu hồi HR/HR Manage

1. Vào `Cài đặt → Người dùng & phân quyền`, chọn tài khoản.
2. Kiểm tra employee liên kết, system role và badge Quản lý trực tiếp trong tab Tổng quan.
3. Chọn `Không có`, `HR` hoặc `HR Manage`; nhập thời hạn nếu có và lý do tối thiểu 10 ký tự.
4. Chạy Preview, đọc phần action C3/C4/export mở hoặc đóng và chấp nhận cảnh báo bắt buộc.
5. Apply đúng fingerprint vừa preview. Sau khi thành công, reload authorization/session và kiểm tra tab Quyền hiệu lực cùng Lịch sử.

System Admin chỉ tự cấp hoặc tự thu hồi `HR Manage` cho chính mình khi profile `ADMIN` và assignment `SYSTEM_ADMIN` còn hiệu lực. Không cấp direct grant C3/C4/export và không dùng system role Admin như HRM bypass.

Nếu báo stale fingerprint, không retry bằng fingerprint cũ: reload tài khoản, preview lại và xác nhận diff mới. Nếu role hết hạn, effective permission phải biến mất mà không cần xóa audit history.

## Manager readiness và `direct_reports`

Chỉ bật manager-derived permissions khi Permission Health xác nhận đồng thời:

- Mọi nhân sự active có đúng một primary assignment hợp lệ hoặc exclusion có lý do.
- Không có assignment hiệu lực chồng lấn.
- Mọi đơn vị có manager chain hợp lệ.
- Không có self-management hoặc vòng lặp.
- Resolver dùng manager slot/primary assignment, không dùng `users.manager_id`.

Khi readiness chưa đạt, giữ deny mặc định. Không tạo assignment giả để làm xanh health check. Sau khi dữ liệu được HR hoàn thiện, chạy lại `hrm_manager_scope_readiness_smoke.sql`, persona matrix và Permission Health trước migration bật gate.

## Import, dry-run và rollback batch

1. Chỉ nhận workbook 8 data sheets cộng sheet `Hướng dẫn`; không import trực tiếp file nguồn phân tích.
2. Upload private, tạo manifest/hash, stage typed rows rồi chạy dry-run.
3. Sửa toàn bộ lỗi `sheet/row/column/error code`; log không được chứa CCCD, ngân hàng hoặc mức lương.
4. Apply theo domain trong transaction. HR không được apply C4; HR Manage vẫn phải có action tương ứng.
5. Retry cùng batch phải idempotent. Nếu apply thất bại, toàn domain rollback; giữ audit/manifest để đối soát.
6. File nguồn và staging hết hạn sau 30 ngày theo cleanup job. Sự cố cleanup không được mở bucket public.

## Xử lý Permission Health incident

Critical HR finding chặn rollout và không được allowlist. Ưu tiên cô lập theo thứ tự:

1. Revoke execute của command RPC liên quan nếu có nguy cơ ghi sai.
2. Giữ raw table grants ở trạng thái revoke và RLS deny-by-default.
3. Xác định finding: anon access, broad C2–C4 policy, legacy Admin/module-admin bypass, sensitive direct grant, template drift, raw exposure hay manager readiness.
4. Tạo migration forward riêng để sửa; không chỉnh file migration đã apply.
5. Chạy SQL persona smoke bằng JWT/PostgREST hoặc `SET LOCAL ROLE authenticated` với claims thực; không lấy kết quả dưới role `postgres` làm bằng chứng duy nhất.
6. Chạy lại Permission Health, Security/Performance Advisor, lint, test và build.

## Rollback an toàn

- Không khôi phục raw read/write cho frontend và không bật lại `Role.ADMIN`, `is_admin()` hoặc HRM module-admin bypass.
- Nếu frontend mới gặp lỗi, dừng mutation bằng revoke `EXECUTE` các command RPC bị ảnh hưởng và hạ UI về read-only/deny.
- Khôi phục hành vi bằng migration forward có snapshot/precondition; giữ nguyên ID dữ liệu, audit và import manifest.
- Với role change lỗi, thu hồi template qua RPC quản trị, reload session và kiểm chứng effective sources; không sửa trực tiếp grant nhạy cảm.
- Với manager scope lỗi, tắt gate `direct_reports` trước, giữ own/global template access và sửa dữ liệu tổ chức sau.

## Xác minh Cloud sau mỗi migration

Chạy từng file migration bằng Cloud connection trong `.env`, sau đó repair đúng một version. Không dùng local Supabase/Docker và không repair các mismatch lịch sử ngoài phạm vi.

Các smoke bắt buộc:

- `hrm_personnel_permission_registry_smoke.sql`
- `hrm_business_role_self_grant_smoke.sql`
- `hrm_sensitive_rls_smoke.sql`
- `hrm_shared_catalog_org_slots_smoke.sql`
- `hrm_manager_scope_readiness_smoke.sql`
- `hrm_personnel_profile_persona_smoke.sql`
- `hrm_personnel_import_export_smoke.sql`
- `hrm_sensitive_projection_cutover_smoke.sql`
- `hrm_broad_policy_persona_smoke.sql`
- `hrm_permission_health_smoke.sql`

Cuối cùng chạy `npm run lint`, `npm test`, `npm run build`, linked `db lint` và Supabase Security/Performance Advisors. Chỉ deploy frontend khi không có test failure hoặc Critical HR finding.
