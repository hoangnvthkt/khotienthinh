# Task 12.4.2 — Rollout log

## Khởi động — 2026-09-14

- Branch `feature/authorization-v2-task12-4-2`, worktree riêng từ `origin/main` tại `abc35de` sau fetch.
- Cloud main `ftciqmqhmfvjtwoycswe`, xác minh linked ref; dùng `.env` hiện có. Chỉ read-only Cloud ở checkpoint này.
- Baseline: 391 files / 1.862 tests pass (Vitest, 8.08s). Không dùng kết quả này để đánh dấu nghiệm thu release.
- Inventory tại 08:20:54 UTC: 56 active, 3 disabled; nguồn grant/template/policy tổng hợp trong `authorization-v2-task12-4-2-inventory.json`. Không xuất tên/email hoặc dữ liệu nghiệp vụ.

## A0 — Đối soát ledger

Sáu migration đã apply ngày 12/09 còn thiếu trên main. Đã đối chiếu từng statement remote theo đúng thứ tự với file gốc worktree `task-participant-web-push`: toàn bộ 111 statements khớp nguyên văn, phần dư chỉ là dấu kết thúc statement/whitespace. Bản đưa vào branch mới byte-identical với source gốc; không replay SQL, không sửa history Cloud, không mở notification gate.

| File | Statements | SHA-256 source |
|---|---:|---|
| 20260912044730_work_notification_preview_recipients.sql | 8 | 06ec61a4118b04682148aaab466f808e0944d2a7546684e9090566e00c86fe6d |
| 20260912045358_workflow_notification_outbox.sql | 36 | bbf9d177e4085bfc480127eeccbabe8694dd926cc1dc4051c4c0a8a0b0f7061f |
| 20260912045733_workflow_notification_commands.sql | 33 | 193d00f589e77121646997df583d728bd1362c7bdd7a6b60c4629c45b1eeea06 |
| 20260912050458_request_participant_notifications.sql | 11 | 5cd6dbcd7b683d3197a3b977f65be9ab6410f3109ff9231cc6d2b428be138639 |
| 20260912050744_task_notification_deadline_reminders.sql | 20 | d800ef5da6377a147d2b057ea00763c95f8ab225fa5ef46948b46b2063d8e719 |
| 20260912052011_task_notification_source_guards.sql | 3 | e93c51546e09428dc09460a270699363c23dd9e6af91700fadcf520e6b4295a7 |

Allowlist cũng bổ sung migration `20260914075111_request_discussion_rpc_permissions.sql` vốn đã nằm trong main và remote ledger nhưng bị thiếu trong current.json. Migration baseline sau đối soát: **52 active / 402 archived**, pass.

## Trạng thái

- A: đang thực hiện access-map/coverage và persona inventory; A0 đã xác minh source và ledger.
- B–H: chưa triển khai. Không có migration phân quyền mới, không có thay đổi quyền tài khoản thật, chưa bắt đầu observation.
- Task 13: blocked cho tới khi Task 12.4.2 và observation gate đạt.

## A1 — Inventory và access-map

- Đã lưu query read-only tái chạy được, inventory Cloud tổng hợp, access-map cho 18 mục Settings (gồm tab thực, account self-service và org-chart metadata lệch), danh sách 87 submodule registry/route/action/scope.
- Mapping ghi rõ bảng/API owner, các capability dự kiến và quyền dùng chung với WMS/Project/HR; source chưa có phép thay thế tương đương được giữ/manual review, không auto-revoke theo tên.
- Policy `loss_norms_all` vẫn ALL true sau active-account gate; các bảng dùng chung còn quyền read rộng hoặc write admin-only. B phải xử lý enforcement, không chỉ hiện thêm lựa chọn catalog.
- Scope bug được chứng minh ở D: removeApplicationDirectGrants không lọc scope; ActionRow chỉ hiện grant và inherited source đầu tiên. Ưu tiên sửa tiểu-checkpoint D1 này trước batch dữ liệu, độc lập với migration Settings B. Đây là thay đổi thứ tự triển khai; B/C và phần D còn lại vẫn chưa đạt exit.

## D1 — Đã kiểm thử editor, chưa release

- Test RED: 5/6 ca scope thất bại đúng vì gỡ chéo scope; component test nhiều nguồn cũng fail do chỉ hiện grant/source đầu.
- Sửa: chọn rõ phạm vi khi module có nhiều scope, giữ scope khác/nguồn ẩn; mỗi direct tuple có control ổn định; hiển thị tất cả nguồn kế thừa còn hiệu lực; reload làm mất hiệu lực preview cũ.
- Targeted GREEN: 4 files / 26 tests; TypeScript pass, production build pass (chunk-size warning hiện hữu).
- Playwright Chromium: 3/3 pass — gỡ kho A giữ B/global/ROLE C; gỡ từng row liên tiếp đúng tuple; reload hủy confirmation cũ. Playwright ban đầu thiếu browser, đã cài headless shell; test dùng click rồi kiểm draft vì row biến mất sau khi bỏ chọn, không chờ checkbox đã unmount.
- Đây là kiểm editor với dữ liệu giả, không phải persona production hay kiểm RLS. Không có Cloud mutation cho D1. Phần receipt/refresh sau lưu và dẫn tới owner của nguồn thuộc D còn lại.

## E1 — Bỏ redirect legacy, chưa release

- App.tsx không còn dùng allowedSubModules để chọn landing khi route bị từ chối. Chỉ quay về tổng quan Dự án nếu capability hiện hành cho phép; nếu không về Home. ADMIN role đơn lẻ và quyền hết hạn không mở landing.
- Scanner runtime mở rộng tới App/root, context và Edge Functions; mapper/type legacy còn giữ được allowlist riêng, không cho phép làm quyết định quyền.
- RED: 5 ca thất bại trước sửa; GREEN targeted: 4 files / 35 tests. Hồi quy sau sửa: 393 files / 1.873 tests pass; TypeScript pass; baseline 52 active / 402 archived; audit/check Supabase queries đều 0 findings; git diff --check pass.
- Chỉ hoàn tất tiểu-checkpoint redirect/scanner, không thay thế nghiệm thu toàn bộ menu/route/API E. Settings B, account transition C, receipt/refresh D, surface API coverage E và F–H vẫn đang chờ triển khai.

## D2a — Tách trạng thái lưu khỏi tải lại

- UserModal phân biệt mutation thất bại với mutation có receipt nhưng refresh thất bại. Trường hợp thứ hai khóa form sửa và hiện “Đã lưu tài khoản — chưa tải lại được quyền”; nút tải lại chỉ gọi read-refresh, không gửi mutation lần hai.
- Receipt target được dùng để refresh. Trạng thái chờ không bị xóa chỉ vì parent thay object của cùng tài khoản. Đóng/mở hoặc chuyển tài khoản mới reset trạng thái.
- RED đã tái hiện lỗi network sau write bị ném như lỗi save; GREEN 3 tests cho write reject, refresh reject và thứ tự write/read đúng target. Hồi quy 394 files / 1.876 tests pass; TypeScript/build pass (cảnh báo chunk-size hiện hữu).
- Chưa nghiệm thu browser lỗi mạng trên UserModal thật, so version/count của snapshot với receipt, cross-session/offline refresh. Các mục này và B/C/F–H vẫn chưa hoàn tất; không diễn giải D2a là toàn bộ D đã đạt.

## B1 — Capability Cài đặt chi tiết, chờ apply Cloud

- Bổ sung 14 phân hệ Cài đặt với cặp Xem/Quản lý; gói Xem mặc định chỉ gồm 8 mục vận hành thông thường. Người dùng, Cảnh báo, Permission health, AI Learning và Bảo trì không nằm trong gói; các quyền nhạy cảm không cho direct grant.
- UI mở đúng tab theo capability; manage kéo theo view; `system.settings.manage` tiếp tục là nguồn cha. Tài khoản chỉ có Xem thấy cảnh báo read-only và các control native bị khóa.
- Backend thêm helper theo JWT actor, mở bổ sung RLS cho caller Settings nhưng giữ nguyên caller WMS/Dự án. RPC binding kho, danh mục DA và nhóm làm việc dùng cùng capability. Policy `loss_norms_all = true` được thay bằng view/manage riêng. Branding `app_settings` vẫn cho active account đọc vì cần lúc bootstrap, chỉ khóa write.
- TDD frontend: 5/5 ca RED trước sửa; GREEN 2 files / 23 tests. Migration và SQL smoke được chạy ghép trên Cloud main trong transaction rồi rollback: view không update được app_settings, manage update được, capability không lan feature, sensitive bundle bị loại. Post-rollback xác nhận 0 module/action/policy thử nghiệm còn lại.
- Hồi quy trước commit: 395 files / 1.881 tests pass; TypeScript và production build pass (chunk warning hiện hữu); migration baseline 53 active / 402 archived; query audit/check 0 finding; dry-run chỉ liệt kê migration `20260914084622`.
- Chưa apply migration hoặc cấp/gỡ quyền tài khoản thật tại thời điểm ghi mục này. Các mục nhạy cảm còn `declared` và role-only cho tới khi endpoint tương ứng được audit ở checkpoint tiếp theo.
