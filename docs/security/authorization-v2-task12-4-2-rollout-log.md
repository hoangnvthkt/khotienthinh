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
