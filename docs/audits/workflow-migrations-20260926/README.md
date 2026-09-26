# Kiểm tra và apply workflow migrations — 26/09/2026

Đã apply trên Supabase Cloud `ftciqmqhmfvjtwoycswe`, khớp `VITE_SUPABASE_URL` trong `.env` và linked project. Chỉ apply hai migration được yêu cầu; không chạy các migration khác đang pending. Hai file nằm trong worktree `feature+Clone-UI-Base-Workflow` và vẫn chưa commit.

## Các điểm đã gia cố trước khi apply

- Watcher helper: revoke rõ quyền PUBLIC, anon, authenticated và service_role; Cloud xác nhận chỉ postgres còn EXECUTE.
- Resolver xử lý JSON null/non-array như danh sách rỗng; UUID được kiểm tra đúng cấu trúc trong CASE trước khi cast. Dữ liệu sai định dạng không làm hỏng chuyển bước.
- Khi chuyển bước của instance đã liên kết workflow_subjects, trigger không đọc watcher từ mẫu live. Project runtime tiếp tục dùng snapshot và participant pool hiện có. Khi tạo mới, config live và snapshot chưa diverge.
- Configuration RPC kiểm tra quyền đọc room, quyền quản lý binding hoặc quyền xem template trước khi trả binding/validation/metadata. Chỉ che tên template là chưa đủ.
- Loại bỏ mẫu inactive khi đọc binding để khớp resolver. Subject null bị từ chối rõ ràng.

## Kết quả xác minh

- 13/13 Vitest trong workflowStepWatcherAutotag.test.ts và projectOwnedWorkflowTemplateMigration.test.ts đạt.
- Thực thi cả hai migration + smoke trong transaction Cloud có rollback đạt trước khi apply.
- Smoke Cloud sau apply đạt: watcher merge/retention, UUID và JSON lỗi, clone graph 3 nodes/2 edges, idempotency, cross-project binding denied, unauthorized clone/config denied, helper ACL.
- Test dưới role authenticated: admin clone/read thành công; actor không có grants/staff không clone/read/call helper được. Fixtures được rollback toàn bộ.
- Apply trong một transaction, lock_timeout 5s và statement_timeout 60s. SQL và lịch sử migration cùng commit. Nội dung statements trong history khớp byte-for-byte hai file đã gia cố; SHA-256 nằm trong workflow-postflight-summary.json.
- RLS vẫn bật trên templates/nodes/edges. Trigger hiện diện.
- Checksum dữ liệu trước/sau khớp: 41 templates, 165 instances, 116 subjects, 644 instance nodes, 23 bindings. Không backfill watcher và không tự clone dự án nào (owned_templates = 0).
- Security advisors đã chạy và trả 224 warnings. Ba warnings liên quan là authenticated_security_definer_function_executable cho clone/config/set-binding: quyền gọi RPC là chủ ý, đã rà authentication, room/template gates và kiểm tra role thực tế. Không có warning search_path hoặc anon EXECUTE cho các function thay đổi. 221 warnings khác ngoài scope; xem security-advisors-summary.json. Kết quả này không đồng nghĩa toàn database đã sạch cảnh báo.

## Giới hạn và recovery

Smoke không bao phủ UI, mọi tổ hợp quyền room hoặc stress-test clone đồng thời. Clone dùng advisory transaction lock theo dự án và unique partial index để chống tạo hai bản active. Quyền WF catalog hiện có được giữ nguyên theo thiết kế migration; bản riêng bổ sung quyền room chứ không tước quyền admin/catalog.

restore-existing-predicates.sql lưu định nghĩa cũ của năm function bị replace, để hỗ trợ recovery có kiểm soát. Đây không phải script rollback toàn bộ: không xóa ownership columns, cloned templates, lịch sử hay trigger mới. Không chạy lại tự động sau khi tính năng đã có dữ liệu.
