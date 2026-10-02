# Task 13 — Khảo sát tác động khi xóa 4 cột legacy (02/10/2026)

**Phạm vi:** chỉ đọc, không đổi gì trên Cloud. Cột: `public.users.allowed_modules`, `admin_modules`, `allowed_sub_modules`, `admin_sub_modules`.
**Cập nhật 02/10 (sau khảo sát):** bước 1 và 2 của lộ trình đã làm xong, chọn phương án (a); xem rollout log mục "Task 13 — bước 1". Còn bước 3–4 (sau mốc quan sát 09/10).

**Kết luận ngắn (lúc khảo sát):** **chưa xóa được.** Một hàm (`app_private.can_access_module`) vẫn đọc cột và còn nằm trong quyết định cho phép đọc ở 10 bảng danh mục. Nếu xóa ngay, **49 người sẽ mất quyền đọc** các danh mục đó. Cần thay các policy đó trước, rồi mới xóa cột.

## 1. Hiện trạng dữ liệu (86 người đang hoạt động)

| Cột | Số người có dữ liệu |
|---|---|
| `allowed_modules` | 56 |
| `admin_modules` | 0 |
| `allowed_sub_modules` | 48 |
| `admin_sub_modules` | 7 |

Các cờ an toàn đã tắt đường legacy: `legacy_fallback_disabled`, `legacy_governance_fallback_disabled`, `legacy_permission_writes_disabled` = true; `legacy_projection_enabled`, `project_room_pbac_fallback_enabled` = false. `is_module_admin` **đã không còn đọc cột**.

## 2. Ai còn đọc cột trong quyết định cho phép

Chỉ `app_private.can_access_module(text)`. Nơi gọi:

**a) 11 policy (SELECT) ở 11 bảng**

| Bảng | Điều kiện hiện tại | Đường thay thế đã có |
|---|---|---|
| `inspection_categories`, `inspection_template_items`, `inspection_templates`, `inspection_work_types`, `template_sections` | `DA` hoặc `SETTINGS` (legacy) | policy `*_settings_select` theo `settings_has_action('inspection_templates')` |
| `project_groups`, `project_sectors`, `project_types` | `DA` hoặc `SETTINGS` | policy `*_settings_select` theo `settings_has_action('project_master_data')` |
| `work_groups`, `work_group_members` | `DA` hoặc `SETTINGS` | policy `*_settings_select` theo `settings_has_action('work_groups')` |
| `projects` | `DA` hoặc `project_scope_has_any_grant_v2` | **đã có:** cả 48 người có `DA` đều xem đủ 86 dự án qua đường này, không ai mất |

**b) 7 hàm**

- `work_workspace_create`, `work_workspace_list_sources`: `DA` **hoặc** `project_scope_has_any_grant_v2`. Không ai mất (xem trên).
- 5 hàm Quy trình (`workflow_actor_can_create_instance`, `workflow_actor_can_mutate_own_draft`, `workflow_template_actor_can_edit/publish/view`): `can_access_module('WF')` chỉ chạy khi hành động **chưa enforced**. Mọi hành động Quy trình liên quan đã `enforced`, nên nhánh này là **mã chết**, bỏ được an toàn.

## 3. Thứ sẽ vỡ nếu xóa cột ngay

Đã mô phỏng từng người có `DA`/`SETTINGS` legacy (non-Admin, 49 người, trong giao dịch có rollback):

| Danh mục | Số người mất quyền đọc |
|---|---|
| Loại / nhóm / lĩnh vực dự án (`project_master_data`) | 49 / 49 |
| Mẫu kiểm tra (`inspection_templates`) | 49 / 49 |
| Nhóm công việc (`work_groups`) | 49 / 49 |

Không ai trong 49 người có capability `settings_has_action` tương ứng, nên họ chỉ đọc được nhờ cột legacy. Hậu quả thực tế: các ô chọn loại dự án, nhóm, mẫu kiểm tra, nhóm công việc có thể rỗng với người không phải Admin.

## 4. Các đối tượng khác chặn việc drop cột (cần thay hoặc xóa trong cùng migration Task 13)

- Hàm: `resolve_effective_permission_sources` (nguồn LEGACY), `get_permission_health_summary_legacy_base`, `list_authorization_principals_impl`, `get_authorization_legacy_migration_summary`, `user_permission_state_fingerprint`, `normalize_legacy_permission_state`, `sync_legacy_permission_projection`, `guard_and_audit_legacy_permission_write`, `prevent_users_privilege_self_update`, `sync_user_account_status_compat`, ba hàm vòng đời tài khoản (`prepare_user_account_lifecycle`, `get_user_account_lifecycle_preview`, `complete_user_account_lifecycle`), hai hàm lệnh cũ `apply_user_permission_change_impl`, `preview_user_permission_change_impl`.
- Trigger: `users.trg_users_guard_legacy_permission_writes`.
- Quyền cột của `authenticated` trên 4 cột (SELECT/INSERT/UPDATE/REFERENCES) cần thu hồi.
- Code ứng dụng chỉ ánh xạ/hiển thị, không quyết định quyền: `types.ts`, `context/authState.ts`, `lib/supabaseProjections.ts` (danh sách cột select), `lib/auditService.ts` (nhãn), `tests/daily-log/personas.mjs`.

## 5. Đề xuất lộ trình (từng bước, mỗi bước độc lập, có dry-run + smoke)

1. **Chuyển 10 policy danh mục sang capability.** Cần chủ sản phẩm chọn: các bảng này là danh mục dùng chung, ít nhạy cảm. Hai phương án:
   - (a, khuyên) cho mọi tài khoản đang hoạt động đọc 8 bảng danh mục dự án / mẫu kiểm tra; giữ `work_group_members` (có danh sách người) theo `work_groups` / dự án;
   - (b) giữ chặt: chỉ ai có capability `settings_has_action` hoặc có quyền dự án.
2. Bỏ nhánh `can_access_module('WF')` chết ở 5 hàm Quy trình; bỏ nhánh `DA` ở 2 hàm Work workspace và policy `projects` (đã có đường thay).
3. Thay `resolve_effective_permission_sources` và các hàm quan sát để không đọc cột; bỏ nguồn LEGACY khỏi snapshot.
4. Quan sát 7 ngày (`get_permission_health_summary`), rồi migration cuối: drop trigger, hàm, thu hồi quyền cột, drop 4 cột, bỏ trường khỏi `types.ts` và danh sách select.

**Rủi ro:** bước 1 và 3 đổi quyền đọc của người thật; bước 4 không đảo ngược được (cần sao lưu dữ liệu cột trước khi drop).
