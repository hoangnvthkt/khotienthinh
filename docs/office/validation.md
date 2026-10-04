# Vioo Office P0 — bàn giao mã nguồn, 04/10/2026

## Trạng thái

Đã triển khai mã nguồn P0 trên branch `codex/vioo-office`, tách từ `origin/main` tại `6e32def`. Checkout hiện tại: `/Users/admin/.codex/worktrees/vioo-office/khotienthinh`. **Chưa áp dụng migration, chưa cấp quyền cho tài khoản thật, chưa triển khai frontend.** Theo chỉ dẫn của chủ dự án, kiểm thử backend dùng Supabase Cloud hiện tại trong transaction rồi rollback. Không dùng Docker hoặc Supabase local.

Cloud postflight xác nhận không còn bảng Office, bucket Office, permission application Office, user thử nghiệm hay bản ghi migration `20261004085552`. Xem [kết quả postflight](evidence/cloud-postflight.json).

## Phạm vi được triển khai

- Navigation, tổng quan và các view cá nhân; danh sách phân trang, tìm kiếm và bộ lọc. Kho cha tìm được văn bản trong thư mục con.
- Bốn nghiệp vụ: thông báo, văn bản đến, văn bản đi, văn bản nội bộ. Wizard ba bước; form theo nghiệp vụ; lưu/sửa nháp; rich text tái sử dụng Vioo Work.
- Loại văn bản, tuyến duyệt tuần tự, quy tắc số và cây kho cấu hình trong Office.
- Duyệt nội dung, cấp số và phát hành là các quyền/thao tác riêng. Trả lại có lý do và gửi duyệt lại tạo vòng mới, giữ lịch sử vòng trước.
- Cấp số dùng UPSERT counter trong transaction theo rule/type/year, khóa dòng và unique constraints. RPC có version check và idempotency key; số không được sửa qua giao diện.
- Chốt người nhận khi phát hành, thông báo qua hạ tầng hiện có. Chỉ ghi đã đọc khi người nhận mở nội dung trong tab đang hiển thị. Người soạn không tự được đánh dấu đã đọc.
- Văn bản đến giữ số bên gửi, hỗ trợ phân phối, giao người phụ trách/phối hợp, hạn xử lý, tiếp nhận, bắt đầu và kết quả hoàn thành.
- Follow/favorite, thu hồi, lưu trữ, lịch sử và audit. Văn bản thu hồi vẫn có cảnh báo sau khi lưu trữ và không xuất hiện trong danh sách chưa đọc.
- File private; server cấp reservation/bucket/path; chỉ cho sửa file khi nháp/cần chỉnh sửa. Kiểm tra loại, kích thước và metadata trước khi hoàn tất; signed URL ngắn hạn.
- Quyền canonical theo global/own/assigned/department/project/construction_site, RLS và restrictive storage policies. Quyền ADMIN kỹ thuật không tự cấp quyền Office. Direct writes vào bảng nghiệp vụ bị chặn.

P1/P2 của đặc tả chưa triển khai: template nâng cao, export sổ, history nâng cao, related documents, liên kết ERP generic, acknowledgement bắt buộc, báo cáo, scan UX, OCR/AI, chữ ký số. Editor P0 dùng các định dạng hiện có của Vioo Work; chưa bổ sung bảng và ảnh nội tuyến.

## Kết quả kiểm thử

| Kiểm tra | Kết quả | Chứng cứ |
| --- | --- | --- |
| Build ứng dụng | PASS | [log](evidence/branch-build.txt), 25.44 giây; còn cảnh báo kích thước chunk của ứng dụng |
| TypeScript toàn repo (`npm run lint`) | PASS | [log](evidence/branch-typecheck.txt) |
| Toàn bộ unit/integration suite (`npm test`) | PASS, 3.007 tests; 2 skipped | [log](evidence/branch-tests.txt) |
| Migration allowlist và Supabase query audit | PASS | [migrations](evidence/branch-migrations.txt), [queries](evidence/branch-queries.txt) |
| UI desktop / tablet / mobile | PASS, 8 tests | [log](evidence/browser-tests.txt) |
| Cloud SQL lifecycle / permissions / RLS | PASS; rollback toàn transaction | [log](evidence/cloud-rollback.txt) |
| Xác nhận không thay đổi Cloud | PASS | [postflight](evidence/cloud-postflight.json) |

Cloud assertions bao gồm: bốn nhóm văn bản; idempotent create/number; stale edit; duyệt đúng thứ tự; không cấp số sớm; người duyệt không được cấp số; publish, receipt, favorite, archive/search; return/edit/resubmit; metadata tệp, storage ACL và cleanup; giao/tiếp nhận/bắt đầu/hoàn thành; thu hồi; immutability kể cả UPDATE bằng chủ bảng; notifications/audit. Cùng loại/năm nhận số kế tiếp; retry không tăng counter. Người công trường A không đọc được confidential của B qua SELECT/RPC; quyền xem thông thường ở B vẫn cần quyền hạn chế hoặc liên quan trực tiếp.

UI chạy production components/service adapter với dữ liệu giả lập, không kết nối Supabase. Viewports: 1440×1050, 820×1180, 390×844. Đã walkthrough và xem ảnh các màn hình tổng quan, danh sách, soạn thảo, chi tiết; kiểm tra không tràn ngang, picker trong dialog, lỗi dashboard, thu hồi/lưu trữ và xử lý văn bản đến.

### Tách khỏi các lỗi của checkout cũ

Branch Office được tạo từ `origin/main`, chỉ mang thay đổi Office. TypeScript và toàn bộ unit suite nay đã pass bằng lệnh CI tiêu chuẩn; không cần loại trừ prototype hoặc checkout lồng. Các lỗi đã báo ở lần kiểm thử trước thuộc workspace `feature/refactor-du-an-t9-1`, không được đưa vào branch này.

Office vẫn được thêm tường minh vào allowlist frontend đi trước DB của contract hiện có, vì chủ dự án chưa cho áp migration. Sau rollout cần refresh fixture rồi bỏ 14 mã Office khỏi allowlist. Thêm file migration vào `supabase/baseline/current.json` chỉ phục vụ kiểm tra mã nguồn, không thực hiện SQL trên Cloud.

Xem [kết quả branch](evidence/branch-validation.json) và [kế hoạch toàn bộ Office](roadmap.md).

## Giới hạn nghiệm thu và bước kích hoạt còn lại

**Chưa xác nhận nghiệm thu end-to-end trên môi trường triển khai.** Những phần sau cần môi trường có migration đã commit:

1. Hai phiên/browser cấp số đồng thời và thử retry khi mất phản hồi mạng. Rollback hiện tại đã kiểm tra thứ tự, uniqueness và idempotency trong một transaction; schema chưa commit không thể được phiên thứ hai nhìn thấy. Không gọi đây là bài kiểm thử race condition đã hoàn tất.
2. Tệp thật qua Storage HTTP, signed URL và tài khoản Auth thật. SQL hiện kiểm tra RLS dưới role `authenticated` với JWT claims fixture; dữ liệu tệp là metadata thử nghiệm trong transaction, không upload bytes thật.
3. Thông báo realtime/push thực tế và walkthrough dưới các tài khoản được phân quyền qua giao diện Vioo. Các notification/audit insert đã được kiểm tra trong transaction, không gửi thông báo thật.

Khi chủ dự án quyết định kích hoạt: dùng quy trình migration của repository cho đúng một migration Office; cấp `office.module.access`, quyền xem/phạm vi và các action theo nhiệm vụ qua quản trị quyền hiện có; cấu hình người duyệt, loại văn bản, quy tắc số và kho; chạy ba mục nghiệm thu trên trước khi mở rộng sử dụng. Không có grant tự động cho người dùng thật trong migration. Nếu tiếp nối sổ cũ, cần xác nhận mốc chuyển đổi số trước khi đưa vào dùng.

Rollback vận hành: thu hồi quyền truy cập Office hoặc gỡ route khỏi bản frontend để ngừng sử dụng; giữ dữ liệu và số đã phát hành, không DROP bảng hoặc tái sử dụng số.

## Lệnh chạy lại

Từ root repository:

```sh
npm run lint
npm test
npm run check:supabase-migrations
npm run check:supabase-queries
npx playwright test -c tests/office/playwright.config.ts
npm run build
node --env-file=.env scripts/office/cloud-rollback.mjs supabase/tests/office_p0_smoke.sql
```

Lệnh Cloud cuối chỉ phù hợp khi migration Office chưa áp dụng và vẫn được phép kiểm thử rollback trên Cloud này. Runner dùng `.env`, không in secrets, đặt lock timeout 3 giây và statement timeout 45 giây.

## Ảnh kiểm tra bằng dữ liệu giả lập

- [Tổng quan desktop](evidence/desktop-overview.png)
- [Soạn thảo desktop](evidence/desktop-draft.png)
- [Chi tiết desktop](evidence/desktop-detail.png)
- [Chi tiết tablet](evidence/tablet-detail.png)
- [Danh sách mobile](evidence/mobile-list.png)
