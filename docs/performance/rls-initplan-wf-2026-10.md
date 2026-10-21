# RLS InitPlan module Quy trình — đo và chứng minh tương đương (20/10/2026)

Việc H1 trong [audit bảo mật + hiệu năng 20/10](../audits/security-performance-scale-2026-10-20/README.md), PR-2 sau module Kho (#267, [báo cáo](rls-initplan-wms-2026-10.md)).
Migration: `supabase/migrations/20261021150000_rls_initplan_wf.sql`.

Cách đo: Supabase Cloud `ftciqmqhmfvjtwoycswe` qua kết nối trong `.env`, transaction `begin … rollback` (chỉ tạo hàm mới trong
transaction, **không** `alter policy` để không giữ khóa), `set_config('request.jwt.claims', …)` của từng người. Thời gian là
`EXPLAIN (ANALYZE)` phía máy chủ, không tính mạng.

## 1. Vì sao chậm

| Thành phần của `workflow_instance_actor_can_select(id)` | Mỗi lần gọi | Phụ thuộc |
|---|---:|---|
| `has_permission(view, global)` + `has_permission(administer, global)` | 12,6 ms | chỉ người dùng |
| `is_module_admin('WF')` | 6,2 ms | chỉ người dùng |
| `workflow_instance_user_follows(id, me)` | 2,2 ms | dòng |
| `project_workflow_actor_can_select(subject)` | 1–3,8 ms | dòng |
| `workflow_template_actor_can_view(id, me)` (mẫu) | 8,5 ms | 6 ms chỉ người dùng |

Postgres gọi lại toàn bộ cho **mỗi dòng quét**, kể cả dòng bị loại: nhân viên thường không có quyền WF phải quét 270 phiếu
để trả về 0 dòng → 2,3–2,6 s; 65 mẫu → 0,4 s; `workflow_nodes`/`workflow_edges` (310/240 dòng, policy theo mẫu) → 2 s.

## 2. Cách sửa

Năm hàm `STABLE SECURITY DEFINER` tính **một lần mỗi câu lệnh** (InitPlan), policy chỉ còn `cột = any((select hàm())::uuid[])`:

| Hàm | Trả về | Thay cho |
|---|---|---|
| `workflow_actor_flags()` | `{admin, wf_admin, inst_view, inst_admin, tpl_view:<token>}` | `is_admin`, `is_module_admin('WF')`, 2 × `has_permission` toàn cục, `workflow_has_action(template.view)` |
| `workflow_visible_subject_ids()` | subject nhìn thấy | `project_workflow_actor_can_select(subject)` |
| `workflow_subject_visible_instance_ids()` | phiếu có subject nhìn thấy | nhánh subject của `workflow_instance_actor_can_select` |
| `workflow_visible_instance_ids()` | phiếu nhìn thấy | `workflow_instance_actor_can_select(id)` |
| `workflow_visible_template_ids()` | mẫu nhìn thấy | `workflow_template_actor_can_view(id, me)` |

Policy SELECT đổi: `workflow_instances`, `workflow_instance_comments`, `workflow_step_tasks` (ALL), `workflow_subjects`,
`workflow_participants`, `workflow_step_assignments`, `workflow_sla_notifications`, `workflow_subject_comments`,
`workflow_instance_nodes`, `workflow_instance_edges`, `workflow_template_versions`, `workflow_templates`, `workflow_nodes`,
`workflow_edges`. Không đổi: policy ghi, chốt `active_actor_gate`, `wf_logs_select` (đi qua RLS của `workflow_instances`),
`workflow_print_templates`.

## 3. Chứng minh tương đương

- `has_permission(u, mã, loại, id)` ⇔ tồn tại nguồn của (u, mã) mà `scope_covers`: nguồn `global` phủ mọi phạm vi; nguồn cùng
  loại với id `*` hoặc đúng id. Với loại `own`/`assigned` và id = chính người dùng, điều này ⇔ token `'global:*'` hoặc
  `'own:*'`/`'assigned:*'` của `permission_source_token` (đã dùng ở #267).
- `project_workflow_actor_can_select(subject)`: `material_request` ⇔ dòng `requests` của subject thoả
  `material_request_can_select_v2` = biểu thức `requests_select` sau #267 (đã chứng minh ở đó); loại khác ⇔ tôi là participant
  active của subject (`workflow_subject_can_select` join `subject_type = 'material_request'` nên luôn sai với loại khác).
- `workflow_instance_user_follows` viết lại theo tập participant active của tôi, giữ nguyên bốn điều kiện OR.
- `workflow_template_actor_can_view`: sáu nhánh OR ánh xạ 1–1 sang sáu nhánh của `workflow_visible_template_ids()`;
  nhánh "mẫu có phiếu có subject nhìn thấy" dùng `workflow_subject_visible_instance_ids()`; nhánh quyền phòng dự án chủ mẫu
  tính một lần cho 2 dự án chủ.

**Kiểm hồi quy trên Cloud (88 người active có đăng nhập, rollback):** với từng người, lấy tập khoá chính nhìn thấy theo hàm
cũ (gọi theo dòng) và theo hàm mới cho bốn bảng, so hiệu đối xứng.

| Vai | Người | Phiếu nhìn thấy (min–max) | Mẫu nhìn thấy (min–max) | Lệch phiếu / subject / mẫu / phiên bản |
|---|---:|---|---|---|
| ADMIN | 4 | 206–243 | 65–65 | 0 / 0 / 0 / 0 |
| EMPLOYEE | 84 | 0–223 | 0–65 | 0 / 0 / 0 / 0 |

Chạy 5 phút 15 giây (phần lớn là hàm cũ).

## 4. Kết quả đo

| Truy vấn | Vai | Trước | Sau |
|---|---|---:|---:|
| 50 phiếu mới nhất `workflow_instances` | nhân viên thường | **2.648 ms** | **27 ms** |
| 50 phiếu mới nhất | Admin | 403 ms | 31 ms |
| Danh sách mẫu `workflow_templates` | Admin | 51 ms | 22 ms |
| Danh sách mẫu | nhân viên thường | ~400 ms (đo audit) | 19 ms |
| `workflow_nodes` theo mẫu | nhân viên thường | ~2.100 ms (prod trung bình) | 20 ms |
| `workflow_subjects` | nhân viên thường | — | 7 ms |
| 50 dòng `workflow_instance_logs` (qua RLS phiếu) | nhân viên thường | ~1.300 ms (prod trung bình) | 28 ms |

Chi phí còn lại (~20 ms) là một lần `resolve_effective_permission_sources` (≈10 ms) + một lần `wms_action_scope_tokens` cho
subject đề xuất vật tư; nếu cần giảm tiếp thì làm bước 3 của audit (đệm quyền theo phiên).

## 5. Sau khi áp

Tích hợp Supabase GitHub tự áp migration khi merge vào `main`. Sau đó đo lại theo vai nhân viên thường:

```sql
begin;
select set_config('request.jwt.claims', json_build_object('sub', auth_id, 'role','authenticated','email', email)::text, true)
from public.users where is_active and role <> 'ADMIN' and auth_id is not null order by created_at desc limit 1;
set local role authenticated;
explain (analyze) select id, code, status from public.workflow_instances order by created_at desc limit 50;
explain (analyze) select id, name from public.workflow_templates;
explain (analyze) select id from public.workflow_nodes;
rollback;
```

Việc tiếp theo của H1: HRM (`hrm_attendance_proposals` 2,6 s, `hrm_leave_*` 0,9 s) rồi Tài sản còn lại.
