# RLS InitPlan module Nhân sự — đo và chứng minh tương đương (20/10/2026)

Việc H1 trong [audit bảo mật + hiệu năng 20/10](../audits/security-performance-scale-2026-10-20/README.md), PR-3 sau Kho (#267,
[báo cáo](rls-initplan-wms-2026-10.md)) và Quy trình (#268, [báo cáo](rls-initplan-wf-2026-10.md)).
Migration: `supabase/migrations/20261021170000_rls_initplan_hrm.sql`.

Cách đo: Supabase Cloud `ftciqmqhmfvjtwoycswe` qua kết nối trong `.env`, transaction `begin … rollback` (chỉ tạo hàm mới, không
`alter policy`), `set_config('request.jwt.claims', …)` của từng người. Thời gian là `EXPLAIN (ANALYZE)` phía máy chủ.

## 1. Vì sao chậm

| Hàm gọi theo dòng | Mỗi lần gọi | Phụ thuộc | Dùng ở |
|---|---:|---|---|
| `hrm_can_access_employee_subject(nv, mã)` | 8,3 ms (trong đó `has_governed_hrm_permission` toàn cục 12,6 ms khi không có quyền) | chỉ người dùng, trừ bước so nhân viên | đề xuất chấm công, đơn phép, phép tồn, biến động phép, miễn passkey |
| `hrm_can_access_leave_request(đơn, mã)` | 12,3 ms | như trên | nhật ký phép |
| `hrm_employee_is_current_user(nv)` | 3,2 ms | chỉ người dùng + so id | đề xuất chấm công, thiết bị chấm công |
| `hrm_is_location_manager(loại, id)` | 0,9 ms | dòng | đề xuất chấm công |
| `can_view_hrm_payroll_3p()` | 12,7 ms | chỉ người dùng | 6 bảng lương 3P |
| `current_user_has_hrm_template_permission(mã)` | 6,4 ms | chỉ người dùng | 13 policy danh mục HR |

Nhân viên thường mở đề xuất chấm công: quét 229 dòng × ~12 ms → 2,7 s; phép tồn 0,8 s; nhật ký phép 0,85 s.
`hrm_attendance` và `hrm_employee_shifts` đã dùng hàm tập `current_actor_hrm_visible_employee_ids` từ trước (19–22 ms).

## 2. Cách sửa

| Hàm mới / dùng lại | Trả về | Thay cho |
|---|---|---|
| `current_actor_hrm_visible_employee_ids(mã)` (có sẵn) | nhân viên tôi được xem theo mã | `hrm_can_access_employee_subject(nv, mã)` |
| `hrm_visible_leave_request_ids(mã)` | đơn phép của nhân viên tôi được xem | `hrm_can_access_leave_request(đơn, mã)` |
| `hrm_current_user_employee_ids()` | hồ sơ nhân viên là chính tôi (6 điều kiện khớp danh tính) | `hrm_employee_is_current_user(nv)` |
| `hrm_managed_location_tokens()` | `'construction_site:<id>'`, `'office:<id>'` tôi quản lý | `hrm_is_location_manager(loại, id)` |

Policy đổi: `hrm_attendance_proposals`, `hrm_leave_requests` (subject), `hrm_leave_balances`, `hrm_leave_balance_changes`,
`hrm_attendance_passkey_exemptions`, `hrm_leave_logs` (subject), `hrm_attendance_devices`; 6 policy lương 3P và 13 policy danh
mục chỉ bọc `(select …)` (policy ALL bọc cả `WITH CHECK`). Không đổi: policy ghi, chốt RESTRICTIVE, policy người duyệt đơn phép.

## 3. Chứng minh tương đương

- `hrm_can_access_employee_subject(nv, mã)` với actor = người đang đăng nhập: toàn cục → đúng với mọi nhân viên; không thì
  nhân viên phải có `user_id`, và (own ∧ `user_id` = tôi) ∨ (direct_reports ∧ quản lý trực tiếp của `user_id` = tôi).
  `current_actor_hrm_visible_employee_ids(mã)` trả: toàn cục → mọi nhân viên; không thì nhân viên có (own ∧ `user_id` = tôi)
  ∨ (direct_reports ∧ `resolve_strict_direct_manager(user_id)` = tôi); nhân viên không có `user_id` không khớp vế nào. Trùng.
- `hrm_can_access_leave_request` = `hrm_can_access_employee_subject(employeeId của đơn)` → đơn có `employeeId` ∈ tập trên.
- `hrm_current_user_employee_ids()` chép nguyên sáu điều kiện OR của `hrm_employee_is_current_user`, chỉ bỏ điều kiện
  `e.id = p_employee_id` để trả tập.
- `hrm_is_location_manager(loại, id)` ⇔ `hrm_location_manager_id(loại, id) = tôi`: loại `construction_site`/`office` tra
  `managerId` (rỗng → null); loại khác → null → sai. Token `loại || ':' || id` khớp đúng các dòng đó; `loại` hoặc `id` null →
  chuỗi null → không khớp, như cũ.

**Kiểm hồi quy trên Cloud (88 người active có đăng nhập, rollback):** với từng người và từng bảng, so tập khoá chính nhìn thấy
theo biểu thức policy cũ và mới.

| Bảng | Người | Nhìn thấy (min–max) | Lệch |
|---|---:|---|---:|
| `hrm_attendance_proposals` | 88 | 0–229 | 0 |
| `hrm_leave_requests` (subject) | 88 | 0–28 | 0 |
| `hrm_leave_logs` (subject) | 88 | 0–52 | 0 |
| `hrm_leave_balances` | 88 | 0–78 | 0 |
| `hrm_leave_balance_changes` | 88 | 0–87 | 0 |
| `hrm_attendance_passkey_exemptions` | 88 | 0–24 | 0 |
| `hrm_attendance_devices` | 88 | 0–50 | 0 |

## 4. Kết quả đo

| Truy vấn | Vai | Trước | Sau |
|---|---|---:|---:|
| 50 đề xuất chấm công | nhân viên thường | **2.759 ms** | **20 ms** |
| 50 đề xuất chấm công | HR (quyền xem toàn cục) | 277 ms | 6 ms |
| Nhật ký phép | HR | 324 ms | 7 ms |
| Nhật ký phép | nhân viên thường | ~850 ms | 17 ms |
| Phép tồn | nhân viên thường | ~810 ms | 17 ms |
| Đơn phép | nhân viên thường | ~330 ms | 16 ms |

Chi phí còn lại (~16 ms) là một lần `resolve_effective_permission_sources` trong `has_governed_hrm_permission`.

## 5. Sau khi áp

Tích hợp Supabase GitHub tự áp migration khi merge vào `main`. Đo lại theo vai nhân viên thường:

```sql
begin;
select set_config('request.jwt.claims', json_build_object('sub', auth_id, 'role','authenticated','email', email)::text, true)
from public.users where is_active and role <> 'ADMIN' and auth_id is not null order by created_at desc limit 1;
set local role authenticated;
explain (analyze) select id from public.hrm_attendance_proposals limit 50;
explain (analyze) select id from public.hrm_leave_logs;
explain (analyze) select id from public.hrm_leave_balances;
rollback;
```

Sau PR này, H1 còn lại các bảng nhỏ (Tài sản đã làm ở #267). Việc tiếp theo của audit: H2 Realtime → Broadcast, H3 nâng máy.
