# Task 12.4.2 — Legacy runtime dependency gate

Cloud main `ftciqmqhmfvjtwoycswe`, kiểm kê sau migration `20260914093239`. Tài liệu này chỉ chứa tên object và số lượng; không chứa định danh tài khoản hoặc dữ liệu nghiệp vụ.

## Kết luận

Không thể thu hồi hàng loạt shell grants hoặc bắt đầu Task 13. Hai helper dùng cột legacy vẫn nằm trên đường quyết định quyền và có fan-out lớn:

| Helper | Function gọi gián tiếp | Policy gọi trực tiếp | Rủi ro nếu thay cơ học |
|---|---:|---:|---|
| `public.is_module_admin(text)` | 57 | 130 | Một quyền `manage` hẹp có thể mở toàn bộ module; hoặc thay quá chặt làm đứt workflow/WMS/Project đang chạy. |
| `app_private.can_access_module(text)` | 2 | 11 | Một quyền `view` hẹp có thể mở bảng danh mục dùng chung ngoài phạm vi. |

Các policy tập trung ở Project/Room, WMS, Workflow, Contract, Asset, Tender/cost norm và các bảng danh mục Settings. Vì helper dùng chung cho nhiều loại tài nguyên, không được đổi thân helper thành “có bất kỳ capability cùng module” để đóng nhanh.

## Phụ thuộc trực tiếp vào bốn cột legacy

Sau khi Request, Chat và AI Learning đã cutover, Cloud còn 17 function chứa `allowed_modules`, `admin_modules`, `allowed_sub_modules` hoặc `admin_sub_modules`:

- Quyết định quyền đang hoạt động: `public.is_module_admin`, `app_private.can_access_module`.
- Resolver/quan sát quá độ: `resolve_effective_permission_sources`, `get_permission_health_summary_legacy_base`, `list_authorization_principals_impl`, `get_authorization_legacy_migration_summary`, `user_permission_state_fingerprint`.
- Guard/projection/lifecycle cần giữ tới Task 13: `guard_and_audit_legacy_permission_write`, `prevent_users_privilege_self_update`, `sync_legacy_permission_projection`, `sync_user_account_status_compat`, `sync_auth_user_profile`, ba account-lifecycle function.
- Command cũ đã bị rút quyền execute nhưng còn phụ thuộc schema: `apply_user_permission_change_impl`, `preview_user_permission_change_impl`.

Nhóm quan sát/guard không cấp quyền khi fallback đã off, nhưng vẫn ngăn drop cột ở Task 13. Chúng phải được thay hoặc drop trong migration Task 13 sau observation gate, không xóa trong batch thu hồi quyền người dùng.

## Thứ tự chuyển consumer

1. Settings catalog và Request template: đã có capability/resource contract riêng và smoke authenticated.
2. Chat và AI Learning: đã chuyển helper/RLS sang canonical capability.
3. WMS và Project: tách theo từng action/scope; giữ các Room đã cutover, không chạy lại backfill.
4. Workflow: tách template create/edit/publish và instance act/admin, không gom vào một `manage`.
5. Contract/Asset/Tender/cost norm: thay policy theo đúng owner/action của từng bảng.
6. Sau mỗi cohort, chạy persona menu → URL → API và chỉ đưa shell source của cohort đó vào manifest khi không còn consumer.

## Gate cho manifest thật

- Source chưa có consumer-to-capability mapping vẫn là `manual_review` hoặc `retain`.
- Batch chỉ gồm source đã duyệt, có snapshot/hash Cloud mới nhất và intentional diff rõ ràng.
- Không apply batch có định danh tài khoản trước khi operator duyệt diff cụ thể.
- `persistedBatches` phải giữ bằng 0 trong giai đoạn chuẩn bị này.
