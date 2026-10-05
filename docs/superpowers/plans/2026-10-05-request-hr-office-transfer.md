# Yêu cầu điều động đến bản nháp Office

> Thực hiện trực tiếp bằng agent chính theo executing-plans; không dùng sub-agent theo AGENTS.md.

**Goal:** Tạo mẫu Yêu cầu thật, sau duyệt tự tạo điều động công trường, sau duyệt HR tự tạo bản nháp thông báo Office theo mẫu đã thống nhất.

**Architecture:** Liên kết theo ID mẫu và phiên bản, không theo tên. Hai sự kiện duyệt được xử lý trong transaction, mỗi yêu cầu chỉ tạo một phiếu HR và một bản Office. Phiếu thuộc luồng mới chờ Office phát hành trước khi được áp dụng; các phiếu HR cũ giữ hành vi hiện tại.

**Tech stack:** React, TypeScript, Supabase Cloud PostgreSQL; existing request and Office rich-text templates.

**Spec:** Thiết kế và mẫu đã bàn giao trong cuộc trò chuyện; yêu cầu triển khai ngày 05/10/2026 giới hạn kết quả ở bản nháp Office. Trường hợp đầu: Nguyễn Văn Thanh TT044, RICO → Sơn Miền Bắc, 05/10/2026; admin@khoviet.vn duyệt cả Yêu cầu và HR. Việc tạo theo tài khoản Thanh là thay mặt theo chỉ định người dùng, phải ghi audit; không giả lập phê duyệt.

## Constraints and review focus

- Chỉ branch codex/vioo-office; không chạm worktree chính đang có thay đổi khác.
- Chỉ Supabase Cloud từ .env. Chạy migration và smoke trong transaction rollback trước khi apply.
- Không tự duyệt phiếu thật hoặc tự phát hành. Không cho luồng Office nháp đổi nơi làm/chấm công.
- Repeated events không tạo trùng; reject/cancel không sinh downstream, nguồn thay đổi không âm thầm sửa văn bản.
- Chặn người sai quyền, sai nhân sự/nơi đến, lịch trùng; không suy đoán định danh.
- Ngày bắt đầu là hôm nay: vẫn phải giữ nơi cũ trước khi phát hành.

## Task 1 — Database bridge and templates

- [x] Inspect live schema and assert bridge absent (RED).
- [x] Add private versioned configuration, source links, request validation and approval hook, HR approval → Office draft hook. Reuse all existing permission/overlap checks.
- [x] Add publication gate for integrated assignments and preserve old HR behavior; source links included in existing board.
- [x] Verify Cloud rollback: pending/rejected request no assignment, approved request one pending assignment, HR approval one draft and no HR side effects, retry no duplicates, wrong actor denied, draft cancellation/source changes safe.

## Task 2 — User journey

- [x] Add waiting-for-Office state and source/draft links to assignment detail using current design system.
- [x] Provide the reusable Office notice template with HR fields; field mapping via approved data only.
- [x] Unit tests for waiting state and template variables; typecheck/build and desktop/mobile walkthrough.

## Task 3 — Rollout and first real request

- [x] Self-review schema permissions, concurrency and effect gates; no sub-agent.
- [x] Apply only verified migration, seed actual templates and fixed admin approval route, create initial request with clear on-behalf audit.
- [ ] Commit/push Office branch, integrate/deploy under existing authorization after checks.
- [x] Verify initial request was pending admin with no effects. Human user subsequently approved both gates in the app; one Office draft was automatically generated and employee remains at the origin.

## Verification notes

- Cloud rollback includes both actual approval RPCs, rejection paths, cancellation, missing identity, repeated events, and same-day/future effect guards. No live approval executed.
- Full Vitest: 3,057 passed; application typecheck: 0 diagnostics; build passed. UI at 390/768/1440 px passed with fictional data.
- Production migration and restricted pilot seed applied atomically. Initial request is PENDING.
- Two-column exact print layout, final signatory configuration, PDF issuance acceptance, and wider template administration are follow-ups; this rollout ends at the Office draft.

- CI found Playwright files collected by Vitest; isolated that suite and reran all 3,057 unit tests successfully.
- Cloud Preview replay revealed HR dependencies are future-dated in this repository. Reordered the CLI-created bridge after the existing migration tip; unchanged SQL, reconciled production history only.

- Read-only live verification: user approved both gates; one Office DRAFT created, missing identity fields visible, employee remains at original site. Fixed rich-text viewer whitespace so multiline personnel fields remain readable.
