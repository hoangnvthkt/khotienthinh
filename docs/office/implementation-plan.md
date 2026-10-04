# Vioo Office — P0, 04/10/2026

## Yêu cầu và người dùng

Nguồn: đặc tả 50 mục và 4 ảnh Base Office người dùng cung cấp. Ảnh là tham chiếu nghiệp vụ; dùng giao diện Vioo. Người nhận cần tìm/đọc văn bản, người soạn cần lưu nháp/trình, người duyệt cần biết nội dung và bước đang chờ, văn thư cần cấp số/phát hành và kiểm tra gửi nhận. Thành công là hoàn tất CREATE → DRAFT → SUBMIT → APPROVE → NUMBER → PUBLISH → READ → TRACK → ARCHIVE → SEARCH.

## Kết quả audit

- SPA React/TypeScript/Vite, HashRouter tại `App.tsx`; route guard tập trung tại `lib/routeAccess.ts`; Sidebar dùng registry/module access.
- Quyền canonical: `permission_applications/modules/actions`, `app_private.has_permission`, snapshot hiện hành. Office đăng ký thêm capability trong hệ này; không tạo user/role/grant engine riêng.
- Người dùng `users`, cơ cấu `org_units` + effective slot assignments, dự án/công trường `projects` + `project_staff`. Không dùng department legacy để xác định thành viên.
- Rich text: `pages/work/WorkRichTextEditor.tsx` và `WorkRichTextView.tsx` render JSON an toàn. Reuse trong Office.
- File hiện có adapter theo module (`documentService`, `contractAttachmentService`, `workAttachmentService`), chưa có kho attachment generic. Office dùng adapter tiêm phụ thuộc và bucket private do server cấp, cùng Supabase client; UI không chứa storage provider.
- Notification dùng bảng `notifications` và worker/push hiện có; ghi trong transaction nghiệp vụ, deeplink `/office/documents/:id`.
- Audit tập trung `audit_trail`; ghi event từ backend vào đây, timeline Office lọc theo document. Không gọi logger best-effort từ client.
- Workflow hiện tại có chủ thể/gate riêng từng nghiệp vụ. Office dùng cấu hình tuyến duyệt tuần tự và snapshot bước duyệt bất biến; không sửa engine của các module khác.
- Khởi đầu ở workspace có thay đổi ngoài Office; nay Office đã tách sang branch `codex/vioo-office` từ `origin/main` trong checkout riêng. Giữ nguyên thay đổi của các module khác. Không sub-agent, không Docker/local Supabase.
- Cloud trong `.env` trỏ production; staging cấu hình cũ trả 404. Chủ dự án đã cho phép kiểm thử trong transaction rồi rollback, chưa áp dụng migration.

## Thiết kế

- `/office`: tổng quan có chỉ số thật và lối vào công việc cần xử lý. `/office/documents`: search/filter + phân trang, bốn nhóm, các view cá nhân. `/office/documents/:id`: nội dung, file, tiến trình duyệt, người nhận/đọc và lịch sử. `/office/new`: wizard ba bước. `/office/settings`: loại văn bản, tuyến duyệt, quy tắc số và cây lưu trữ.
- Neutral surfaces, accent teal của Vioo Work, Lucide, mật độ enterprise. Mobile chuyển list thành card; form một cột; action rõ ràng. Loading/error/denied không giả số 0.
- Lifecycle và processing độc lập. Snapshot người nhận ở thời điểm phát hành; receipt chỉ từ thao tác mở bản phát hành. Creator không tự được đánh dấu đã đọc.
- Command RPC kiểm tra actor, quyền, trạng thái, version, idempotency. Nội dung/attachment chỉ đổi khi DRAFT/RETURNED chưa cấp số. Không hard delete văn bản đã phát hành.
- Cấp số khóa counter trong transaction, unique rule/type/year/sequence và unique document_number. Không cấp trước khi duyệt đủ; số không tái sử dụng.
- RLS trên mọi bảng Office; private functions + public invoker wrapper; người ngoài phạm vi không được xem confidential bằng REST/RPC/storage. Favorites/follows không tự tạo quyền xem.
- Workflow/type/rule/folder cấu hình trong DB. Permission dùng scope global/own/assigned/department/project/construction_site hiện có. Không tự cấp quyền nghiệp vụ cho tài khoản thật.

## Kế hoạch thực hiện

1. Viết contract/behavior tests: service lỗi và idempotency; SQL các persona/chu trình/truy cập trái phép/khóa phát hành/cấp số; UI flow responsive.
2. Migration additive: catalog quyền, master data, documents/recipients/approvals/processing/files, RPC, RLS, số atomic, notification/audit.
3. Service/types dùng chung, file adapter; tích hợp route/Sidebar/permission registry/deeplink.
4. Giao diện tổng quan/list/wizard/detail/configuration; xử lý loading/empty/error/conflict.
5. Chạy lint, unit suite, build; Cloud rollback smoke và test cạnh tranh khi được xác nhận môi trường; walkthrough desktop/tablet/mobile; ghi kết quả thật và giới hạn.

## Phân kỳ và rollout

P0 theo 22 mục đặc tả. P1: template nâng cao, export, lịch sử phiên bản nâng cao, quan hệ/liên kết ERP generic, acknowledgement, báo cáo, scan UX. P2: OCR/AI/chữ ký số. P0 giữ project/site reference và version để mở rộng. Chưa publish frontend hoặc áp migration production khi chưa có kết quả kiểm thử.

Rollback: migration additive không đổi nghiệp vụ cũ. Có thể gỡ route/module access để tắt Office; giữ dữ liệu và số đã cấp, không DROP bảng hoặc tái sử dụng số. Migration lỗi rollback toàn transaction.

## Tiến độ

- Đã triển khai mã nguồn P0 và hoàn tất các kiểm tra trong phạm vi rollback được cho phép.
- Build, typecheck toàn repo, 3.007 unit/integration tests, 8 browser tests, migration/query checks đều qua trên branch riêng. Cloud rollback assertions đã qua; SQL không đổi khi chuyển branch.
- Chưa kích hoạt Office trên Cloud; nghiệm thu hai phiên cấp số đồng thời và HTTP/Auth/Storage thật còn chờ môi trường đã áp migration.
- Chi tiết: [báo cáo kiểm thử và bàn giao](validation.md).

Kế hoạch tiếp tục toàn bộ P0/P1/P2 trên branch riêng: [roadmap](roadmap.md).
