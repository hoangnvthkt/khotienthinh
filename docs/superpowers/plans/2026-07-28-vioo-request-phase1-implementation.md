# Vioo Request Phase 1 — Detailed Implementation Program

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Triển khai Giai đoạn 1 của Module Yêu cầu thành một hệ thống phê duyệt dùng được thực tế, dùng chung Workflow Engine nhưng tự động chuyển bước, có cấu hình mẫu, giao diện Base × Vioo thích ứng, in và deep link thông báo.

**Architecture:** Chia chương trình thành ba workstream theo dependency. Runtime Foundation khóa contract, schema và transaction trước; Template Administration tạo cấu hình/version trên contract đó; Request Workspace dùng các service đã ổn định để tạo, xử lý, in và thông báo. Mỗi gate phải xanh trước khi workstream phụ thuộc được merge.

**Source of truth:** [Đặc tả đã duyệt](../specs/2026-07-28-vioo-request-phase1-design.md)

## Plan Set

1. [Runtime Foundation](./2026-07-28-vioo-request-phase1-runtime-foundation.md) — database, RLS, versioning, resolver, UUID/mã tuần tự, RPC nguyên tử.
2. [Template Administration](./2026-07-28-vioo-request-phase1-template-admin.md) — quản trị Mẫu yêu cầu, form builder, khối duyệt, phạm vi, in/thông báo.
3. [Request Workspace, Print and Notifications](./2026-07-28-vioo-request-phase1-workspace-print-notifications.md) — tạo phiếu, list/detail, action, deep link, PDF/DOCX, outbox và E2E.

## Decisions Locked for Phase 1

| Chủ đề | Quyết định |
| --- | --- |
| Workflow | Dùng chung Workflow Engine, policy riêng `AUTO_ADVANCE_APPROVAL` |
| Luồng | Tuần tự hoặc song song |
| Hoàn thành | `ALL` hoặc `ANY_ONE` |
| Từ chối | Kết thúc toàn bộ đề xuất ngay |
| Trả lại | Về người tạo, gửi lại đúng khối, giữ kết quả trước |
| Người duyệt | Cố định một/nhiều, quản lý trực tiếp, người tạo chọn linh động |
| Approver bị khóa | Template manager/Admin tái gán, bắt buộc lý do và audit |
| Dynamic approver | @mention bất kỳ nhân viên active cùng công ty |
| Phạm vi mẫu | Công ty, đơn vị/phòng ban, nhóm quyền, người dùng |
| Định danh | UUID nội bộ + `RQ-YYYY-NNNNNN` tăng tuần tự toàn hệ thống theo năm |
| Link | `/rq/:requestId`, kiểm quyền ở backend |
| In | Browser/PDF và DOCX theo mẫu |
| Dữ liệu cũ | Không migrate dữ liệu test/mockup; không xóa dữ liệu module khác |
| Ngoài phạm vi | Condition/branch, webhook, chữ ký điện tử, task/link/discussion, counter tùy chỉnh |

## Execution Sequence

```text
R0 Domain contract
 └─ R1 Schema + RLS + direct manager
     └─ R2 Template publish/version
         ├─ T0–T5 Template Administration
         └─ R3–R6 Submit/actions/queries/smoke
             └─ W0–W6 Workspace/print/notification/E2E
```

Template UI có thể bắt đầu sau R2 trên mock service, nhưng không merge publish flow trước khi R3–R6 xanh.

## Milestone 1: Runtime Contract and Security Boundary

**Plan tasks:** Runtime Foundation Task 1–3.

- [ ] Khóa enum/type và projection test cho sequential/parallel, ALL/ANY_ONE.
- [ ] Bổ sung `manager_id` có RLS và mapping client đúng.
- [ ] Tạo request template/version/instance, relation với shared workflow.
- [ ] Bật RLS, revoke write trực tiếp, index mọi FK/hot path.
- [ ] Chạy local reset, smoke tối thiểu và Supabase advisor.

**Exit:** Gate R0–R1; client không cần biết cấu trúc bảng runtime.

## Milestone 2: Versioned Template and Workflow Compilation

**Plan tasks:** Runtime Foundation Task 4 và Template Administration Task 1–7.

- [ ] Draft reducer/validator là nguồn luật duy nhất trên UI.
- [ ] Publish biên dịch approval blocks thành immutable workflow version.
- [ ] Dựng route/quyền/danh sách mẫu.
- [ ] Dựng general/scope/form/approval/watchers/print/notification.
- [ ] Preview và publish có conflict token.
- [ ] Nghiệm thu cấu hình đủ bốn nguồn người duyệt.

**Exit:** Gate R2 và T0–T5; admin tạo/phát hành template mà không chạm database.

## Milestone 3: Atomic Runtime Commands

**Plan tasks:** Runtime Foundation Task 5–7.

- [ ] Submit resolve người duyệt, snapshot và cấp code.
- [ ] Approve/reject/return/resubmit/cancel qua RPC nguyên tử.
- [ ] Idempotency, optimistic concurrency và lock order có test.
- [ ] List/detail/summary dùng cursor và RLS.
- [ ] SQL smoke chạy trọn tuần tự, song song, trả lại/gửi lại.

**Exit:** Gate R3–R6; có thể vận hành toàn bộ lifecycle qua service test dù chưa có UI cuối.

## Milestone 4: Adaptive Request Workspace

**Plan tasks:** Workspace Task 1–4.

- [ ] Thay bulk context bằng cursor hooks.
- [ ] Route chuẩn `/rq/:requestId`, redirect link query cũ.
- [ ] Tạo phiếu và chọn approver linh động.
- [ ] List/table/master-detail responsive theo bố cục Base × Vioo.
- [ ] Detail/inspector/action bar an toàn với stale data.

**Exit:** Gate W0–W3; creator và approver xử lý được luồng thực tế trên desktop/mobile.

## Milestone 5: Print, Notification and Compatibility

**Plan tasks:** Workspace Task 5–7.

- [ ] Tách DOCX khỏi page; browser/PDF và DOCX dùng snapshot.
- [ ] Ghi audit cho mọi lần in.
- [ ] Transactional notification outbox, retry và canonical route.
- [ ] Chuyển dashboard/home/command palette sang query/service mới.
- [ ] Xóa direct write legacy sau khi không còn consumer.

**Exit:** Gate W4–W5; notification/copy link/in hoạt động và truy vết được.

## Milestone 6: Release Readiness

**Plan tasks:** Workspace Task 8.

- [ ] Full unit/integration test.
- [ ] Supabase reset, smoke và advisors.
- [ ] E2E chín scenario chính.
- [ ] Visual QA 1440, 1024 và 390 px.
- [ ] RLS/replay/concurrency/access-revocation security acceptance.
- [ ] Rollout runbook và feature flag.

**Exit:** Gate W6; đủ bằng chứng để product owner bật thử nghiệm nội bộ.

## Merge Strategy

- Mỗi task tạo một commit độc lập đúng message trong plan con.
- Merge theo thứ tự Runtime Foundation → Template Administration → Workspace.
- Nếu làm song song, Template Administration phải rebase trên contract R2 trước integration.
- Không squash migration với code UI trong lúc review; giữ migration commit độc lập để audit.
- Không chạy migration production trước khi full local reset, smoke, lint và E2E xanh.

## Definition of Done

- [ ] Không còn lỗi TypeScript, Vitest, Vite build, database smoke hoặc E2E.
- [ ] Không có warning RLS/performance mới từ Supabase advisor.
- [ ] Không client nào ghi trực tiếp vào runtime table.
- [ ] Mã request toàn hệ thống không trùng và không tái sử dụng.
- [ ] Mọi command idempotent và chịu được action đồng thời.
- [ ] Người không có quyền nhận cùng phản hồi “không tìm thấy hoặc không có quyền”.
- [ ] Sequential/parallel, ALL/ANY_ONE, reject và return/resubmit đúng đặc tả.
- [ ] Dynamic approver được backend xác thực active/same-company.
- [ ] UI desktop/tablet/mobile được nghiệm thu.
- [ ] Browser/PDF, DOCX và notification deep link có audit/route đúng.
- [ ] Feature flag và rollback forward-only được ghi trong runbook.

## Final Verification Command Set

```bash
npm test
npm run lint
npm run build
npm run smoke:request
npm run test:e2e:request
npx supabase db lint --local --level warning --fail-on warning
git diff --check
```

Mọi command phải exit 0 trên cùng commit sẽ phát hành.
