# Implementation Plan: Thảo luận và chỉnh sửa đề xuất

**Goal:** Bổ sung thảo luận có mention/tệp/ảnh và cho người tạo sửa đề xuất `PENDING`/`RETURNED`, với phê duyệt luôn gắn đúng phiên bản nội dung.

**Architecture:** Dữ liệu cộng tác thuộc riêng Module Yêu cầu, dùng RLS theo quyền xem request và private commands. Nội dung đề xuất có revision bất biến; sửa khi pending đóng round hiện hành và dựng round mới trong cùng transaction. UI create/edit dùng chung renderer, còn attachment dùng bucket private, reservation, worker finalize và signed URL ngắn hạn.

**Tech stack:** React 18, TypeScript 5.8, Vite 6, Supabase Cloud/PostgreSQL, Supabase Edge Functions, Vitest 4 và Playwright.

**Spec:** [Đặc tả đã duyệt](../specs/2026-09-14-request-discussion-edit-design.md)

## Ràng buộc

- Thực hiện tuần tự bằng agent chính trong worktree hiện tại; không dùng sub-agent.
- Mọi thao tác Supabase dùng Cloud qua `.env`; không dùng local Supabase hoặc Docker.
- Migration là forward-only và phải được tạo bằng Supabase CLI.
- Test hành vi phải thất bại đúng lý do trước khi viết production code.
- Backend là authority cho trạng thái, revision, mention candidate, attachment access và capability.

## T01. Đối chiếu nền

- [x] Đối chiếu schema/command Cloud: request, subject/instance, assignment round, resolver, outbox và Storage.
- [x] Chạy baseline TypeScript, build và request/work tests liên quan; ghi lỗi có sẵn nếu có.
- [x] Xác nhận mọi đường duyệt kiểm assignment hiện hành; lập fixture actor/flow cho test Cloud.
- [ ] Ghi baseline UI create/detail để so sánh khi hoàn thiện.

## T02. Revision và detail contract

- [x] Viết test fail cho revision, capability mới và projection round hiện hành.
- [x] Thêm `content_revision`, bảng revision bất biến, baseline cho hồ sơ cũ và revision metadata ở assignment/event.
- [x] Bổ sung `contentRevision`, `currentRoundId`, `canEditContent`, `canComment`, `canAttach` vào detail response và TypeScript validator.
- [x] Chứng minh inspector không lấy approval của revision cũ làm trạng thái hiện hành.

## T03. Sửa nội dung và restart approval

- [ ] Viết unit/Cloud tests fail cho edit theo trạng thái, no-op, stale, idempotency, restart và concurrency. (Còn test hai kết nối đồng thời sau khi preview deploy được.)
- [x] Thêm `update_request_content` với thứ tự khóa thống nhất và validate schema snapshot.
- [x] Pending edit đóng assignment chờ, giữ lịch sử quyết định và dựng round từ đầu; returned edit giữ trạng thái.
- [x] Resubmit sau khi returned content đã đổi chạy lại từ đầu; resubmit không sửa giữ hành vi hiện hữu.
- [x] Chặn quyết định từ round/revision cũ; ghi event/outbox nguyên tử.

## T04. Dữ liệu và API thảo luận

- [x] Viết test fail cho document/mention/reply/edit/cursor/idempotency và RLS.
- [x] Tạo comment, mention, comment revision và attachment metadata với indexes/RLS/grants tối thiểu.
- [x] Thêm list comments, activity feed, mention candidates, comment anchor và comment command.
- [x] Server derive mention từ document; reply chỉ một cấp trong UI; edit yêu cầu author và lock version.

## T05. Attachment

- [ ] Viết test fail cho reservation, ownership, MIME/signature, Office container, quota, finalize/read/cleanup.
- [x] Tạo bucket private `request-attachments`, policies theo operation và command reservation.
- [x] Tách/reuse image processor; thêm kiểm định PDF/TXT/DOCX/XLSX, từ chối macro/encrypted/active content.
- [x] Thêm Edge Function finalize/read, signed URL 5 phút, cleanup và service client.
- [x] Giới hạn 10 tệp/bài, ảnh 5 MiB, tài liệu 25 MiB; file ready mồ côi được cleanup sau 24 giờ.

## T06. Thông báo

- [x] Viết test fail cho recipients, dedupe, self-suppression và deep link comment.
- [x] Mở rộng request outbox/worker cho comment, mention, attachment đã đăng và approval restart.
- [x] Recheck quyền trước delivery; không đưa nội dung/tên tệp vào payload khi không còn quyền.

## T07. Form tạo/sửa

- [ ] Viết test fail cho renderer dùng chung, edit availability, dirty/stale và retry idempotency.
- [x] Tách renderer/validator create-edit; thêm editor theo `canEditContent`.
- [x] Desktop modal 920px/grid label 220px; tablet một cột; mobile full-screen `100dvh` và safe area.
- [x] Pending dùng `Lưu và duyệt lại`; returned dùng `Lưu thay đổi`; refresh detail/list/summary/inspector sau save.

## T08. UI thảo luận và hoàn thiện

- [ ] Viết test fail cho mention keyboard, draft preservation, multi-upload và request/account race.
- [x] Xây composer, feed, reply/edit, drag/drop/paste, preview/progress và attachment viewer/download.
- [x] Áp dụng visual direction Base: xanh cho primary, tím cho mention, amber cảnh báo, đỏ lỗi; chuẩn hóa typography/radius/spacing.
- [ ] QA trực quan light/dark, zoom 200% và viewport 320/375/768/1024/1280/1536; sửa overlap/clipping/wrap.

## Verification và rollout

- [ ] Chạy Vitest liên quan, Cloud matrix/RLS/Storage/concurrency, TypeScript và production build. (Đã pass và kiểm tra lại schema preview đã deploy; còn concurrency hai connection và upload authenticated với dữ liệu preview.)
- [x] Chạy regression Request, Workflow và Work bị tác động.
- [ ] Deploy backend tương thích trước frontend; mở gate read → discussion write → attachments → content edit. (Đã hoàn tất trên preview; production chưa thay đổi.)
- [x] Cập nhật rollout log với migrations, Cloud evidence, ảnh QA, commit và rollback result.
- [x] Review diff theo spec và commit theo checkpoint bằng danh sách file cụ thể.
