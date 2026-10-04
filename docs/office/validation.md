# Vioo Office — kiểm thử và bàn giao, 04/10/2026

## Trạng thái

Mã nguồn P0, toàn bộ P1 và AI/OCR đã được triển khai trên `codex/vioo-office`, nền `origin/main` tại `6e32def`. **Đã kích hoạt production ngày 04/10/2026 theo yêu cầu tiếp theo của chủ dự án:** migration `20261004085552`, quyền cho hai tài khoản được chỉ định, tuyến duyệt mặc định, Edge Function và frontend. Không merge main, không Docker/local và không sub-agent. Kiểm thử nghiệp vụ vẫn dùng transaction/rollback để không để lại văn bản hoặc số thử. Xem [báo cáo production](production-rollout.md).

Đây là module dùng service/RPC thật. Fixture UI chỉ phục vụ kiểm thử. Ứng dụng production đọc database thật, không thay lỗi hoặc kho trống bằng dữ liệu demo.

## Sửa điều hướng sau nghiệm thu người dùng

Ngày 04/10, người dùng báo Mẫu văn bản và Báo cáo bị đưa về trang chủ. Nguyên nhân: `OFFICE_ROUTES` và các trang con đã có hai đường dẫn, nhưng `ROUTE_TO_MODULE` dùng danh sách chép tay thiếu chúng; global route guard từ chối trước khi vào Office. Fixture browser trước đây không đi qua guard này. Đã dùng chung `OFFICE_ROUTES`, bổ sung test quyền/đường dẫn không hợp lệ và cho fixture chạy `canAccessRoute` thật. Hai regression tests thất bại trước sửa, 54 tests liên quan đạt sau sửa; TypeScript và build đạt.

Fix source `d49ccf9` đã lên production trên branch Office, không migration/cấp quyền mới. Kiểm tra bằng phiên đăng nhập thực tế của chủ dự án: mở thư viện và form tạo mẫu, chuyển sang báo cáo lấy dữ liệu thật, tải lại vẫn giữ trang. Thư viện đang trống và báo cáo 0; không tạo mẫu/văn bản thật trong lượt kiểm tra này. Kiểm tra bố cục 390/820/1440 px không tràn ngang. Các browser assertions mới đã được thêm vào suite; lượt này xác minh UI trực tiếp bằng browser, không chạy lại toàn suite Playwright. [Bằng chứng](evidence/route-regression.json), [54 tests](evidence/route-regression-tests.txt).

## Phạm vi hiện có

- Bốn nghiệp vụ: thông báo, văn bản đến, văn bản đi, văn bản nội bộ; dashboard, danh sách phân trang/tìm kiếm/bộ lọc, kho và thư mục con.
- Soạn/sửa nháp, trình/duyệt/trả lại/từ chối, cấp số atomic, phát hành, hủy, hết hiệu lực theo ngày Việt Nam, thu hồi và lưu trữ. Lifecycle độc lập với xử lý văn bản đến.
- Người soạn/gửi, đơn vị ban hành, công trường; gửi nhiều người/đơn vị/công trường/toàn công ty. Tag bổ sung sau phát hành giữ nguyên nội dung chính thức, ghi đợt phân phối và chỉ thông báo người mới.
- Thành viên đơn vị được chốt từ cơ cấu HRM/project staff đang hoạt động lúc gửi. Người nhận cần quyền truy cập Office và quyền xem theo phân công. Xem và chủ động xác nhận đã đọc là hai sự kiện khác nhau.
- Cấu hình loại, tuyến duyệt tuần tự, quy tắc cấp số, cây thư mục; quản trị quyền dùng RBAC hiện có. Không có quyền nghiệp vụ tự động cho ADMIN kỹ thuật.
- Editor Office riêng: đậm/nghiêng/gạch chân/gạch ngang, 4 cách căn lề, heading/list, font/cỡ/màu/nền chữ, chỉ số trên/dưới, link, bảng, ảnh private, hoàn tác/làm lại, dán nội dung được làm sạch. Tệp tối đa 50 MB; tối đa 30 tệp/văn bản.
- Mẫu có biến và lịch sử; số chính thức chỉ điền khi backend cấp số. Export Excel theo bộ lọc, tối đa 5.000 dòng trong một snapshot; vượt giới hạn phải thu hẹp lọc. Lịch sử phiên bản/so sánh, liên kết văn bản/dự án/công việc/hợp đồng theo quyền ở nguồn.
- Báo cáo theo thời gian và phạm vi; tiếp nhận bản scan/chụp từ điện thoại.
- AI/OCR: đọc PDF/ảnh, đề xuất metadata, tóm tắt, hỏi đáp, tìm kiếm và soạn thảo. Edge Function xác thực Auth, đọc qua quyền của caller, kiểm tra lại quyền/version sau phản hồi AI. Quota 10 yêu cầu/phút, 100/ngày/người; không tự lưu/phát hành/duyệt. Chưa có key/model thì báo chưa kích hoạt.
- Notification transaction và deeplink `/office/documents/:id`, chống trùng theo sự kiện/lệnh/người nhận; dùng hạ tầng push hiện có.
- RLS, private Storage, version check, idempotency, snapshot và audit backend; chặn direct writes. Nội dung đã phát hành và số chính thức không sửa được qua privileged UPDATE thông thường.

## Kết quả cuối

| Kiểm tra | Kết quả | Bằng chứng |
| --- | --- | --- |
| TypeScript toàn repo | PASS | [log](evidence/branch-typecheck.txt) |
| Unit/integration toàn repo | 3.016 passed, 2 skipped; 617 files passed | [log](evidence/branch-tests.txt) |
| Production build | PASS, 8,14 giây | [log](evidence/branch-build.txt) |
| Migration baseline / query audit | PASS; 0 findings/errors | [migration](evidence/branch-migrations.txt), [query](evidence/branch-queries.txt) |
| Chromium + WebKit/iPhone 13 mô phỏng | 22 passed | [log](evidence/browser-tests.txt) |
| Edge Function Deno typecheck | PASS | [log](evidence/deno-check.txt) |
| Cloud P0/P1/extended/performance SQL | PASS; toàn bộ rollback | [log](evidence/cloud-rollback.txt) |
| Cloud postflight trước triển khai (lịch sử) | 8 điều kiện sạch tại thời điểm chưa áp | [JSON](evidence/cloud-postflight.json) |
| Production schema + P0/P1/extended | PASS sau áp dụng; fixtures rollback | [JSON](evidence/production-verification.json) |
| Luồng bằng quyền hai tài khoản thật | Soạn/trình → duyệt → cấp số/phát hành → đọc, notification đúng người; rollback | [JSON](evidence/production-verification.json) |
| Production frontend | HTTP 200, Office chunk 200, đúng Cloud và source branch | [JSON](evidence/production-frontend.json) |
| Contract sau refresh permission catalog | 14 tests passed | [log](evidence/production-contract-tests.txt) |

Cloud kiểm tra: lifecycle đủ 4 nhóm, duyệt đúng thứ tự, cấp số/idempotency, immutable content, recipient/receipt/ack, stale edit, templates/history, links/reverse privacy, hủy/hết hạn, quota AI, Storage metadata/RLS và notification. Kịch bản phòng ban xác nhận người đúng đơn vị được xem, người ngoài bị chặn, tag đơn vị thứ hai mới có quyền và đúng một thông báo/người. Đường query tối ưu được so sánh với quyền xem từng văn bản cho cả 7 persona thử nghiệm.

Browser dùng production components/service adapter với fixtures và file blob trong bộ nhớ, không kết nối Supabase. Kích thước 1440×1050, 820×1180, 390×844 cùng WebKit iPhone 13. Kiểm tra tiêu đề/nội dung dài, bảng, xác nhận đọc, tag đơn vị, định dạng/dán an toàn, upload ảnh, hoàn tác/làm lại, lưu và xóa ảnh không mất văn bản. Đã xem ảnh desktop/tablet/mobile. **Đây là mô phỏng trình duyệt, chưa phải kiểm thử trên điện thoại vật lý.**

## GitHub và preview tự động

PR nháp [#95](https://github.com/hoangnvthkt/khotienthinh/pull/95) trên đúng branch, source commit `a11444b`. [GitHub CI](https://github.com/hoangnvthkt/khotienthinh/actions/runs/37202324357) đã PASS typecheck, 3.016 tests, migration/query checks và build trên Ubuntu/Node của CI.

Repository tự tạo Vercel Preview khi push (SUCCESS). Tích hợp **Supabase Preview thất bại** khi dựng database mới tại migration có sẵn trên main `20261006090000_finance_k3a_payables.sql`: insert `finance_internal_partners` tham chiếu supplier chưa có trong `business_partners` (`finance_internal_partners_supplier_id_fkey`, SQLSTATE 23503). File Finance không thay đổi so với base `6e32def`. Không sửa migration Finance đã tồn tại, tạo đối tác giả hoặc bỏ constraint chỉ để làm preview xanh. Đây là giới hạn dựng preview toàn repository, không phải bằng chứng nghiệm thu Office end-to-end. [Kết quả checks](evidence/github-checks.json).

Sau khi chủ dự án cho phép production, đã triển khai đúng một migration Office, function và frontend. Bằng chứng `cloud-postflight.json` là lịch sử trước triển khai; bằng chứng `production-*.json` phản ánh đợt kích hoạt mới. Không suy diễn trạng thái database preview từ production.

## Hiệu năng đo được

Bộ SQL tạo 2.000 văn bản thử rồi rollback: danh sách 25 dòng **144,6 ms**, báo cáo **84,0 ms**, export **136,0 ms** ở phía PostgreSQL. Quyền tập hợp được tính một lần cho mỗi truy vấn; đã so sánh với predicate quyền gốc. Số liệu là một phép đo có giới hạn, không bao gồm mạng/client hay tải đồng thời và không phải cam kết p95 production.

Office được lazy-load: JS 118,23 kB / 33,10 kB gzip; CSS 46,47 kB / 9,02 kB gzip. XLSX import khi xuất. Build vẫn có cảnh báo chunk lớn sẵn có của ứng dụng tổng; không mở rộng refactor ngoài Office.

## Các giới hạn còn lại

- Đã kiểm tra quyền hiện hành của hai tài khoản thật qua RPC dưới role `authenticated` và request claims trong transaction rollback. Chưa kiểm thử đăng nhập browser bằng hai tài khoản, Storage HTTP/signed URL hoặc push tới thiết bị thật. Ở lần rollout đầu chưa có session. Lần sửa điều hướng sau đó đã dùng phiên đăng nhập sẵn của chủ dự án để kiểm tra thư viện/form tạo mẫu và báo cáo; chưa thực hiện ghi dữ liệu thật hoặc kiểm thử đăng nhập tài khoản người duyệt.
- Chưa kiểm thử hai phiên cấp số đồng thời. Đã kiểm tra counter/uniqueness/retry trong transaction; chưa gọi đó là nghiệm thu race condition. Schema nay đã commit, có thể thực hiện ở một đợt nghiệm thu được kiểm soát.
- AI đã có adapter và tests mock, chưa gọi provider thật, chưa kiểm tra chất lượng OCR bằng key/model của chủ dự án.
- Chưa tích hợp chữ ký số vì chưa có provider/chứng thư. `SignaturePad` hiện có là chữ ký ảnh, không phải chữ ký số.
- Office service độc lập UI đáp ứng kiến trúc cho Command Center; chưa có host Command Center trong repo để tích hợp giao diện actions.

Permission contract đã cập nhật 14 mã Office từ DB và bỏ allowlist tương ứng. Migration đã áp dụng; mọi thay đổi schema sau này cần migration mới. Xem [activation.md](activation.md).

## Chạy lại

```sh
npm run lint
npm test
npm run check:supabase-migrations
npm run check:supabase-queries
npx playwright test -c tests/office/playwright.config.ts
npm run build
npx deno check --no-lock --config supabase/functions/office-assistant/deno.json supabase/functions/office-assistant/index.ts
```

Các runner `cloud-rollback.mjs` và `cloud-postflight.mjs` chỉ dành cho trạng thái **chưa áp migration**, không chạy lại trên production đã kích hoạt. Kiểm thử sau triển khai thực thi SQL assertions trong `BEGIN/ROLLBACK` trên schema có sẵn, không nạp lại migration. Dùng lock timeout 3 giây/statement timeout 45 giây và không in secrets. Log chạy ở `.office-run-logs/`; Playwright tự dọn `.office-test-results/`, không lưu log Cloud ở đó.

## Ảnh từ dữ liệu giả lập

[Desktop tổng quan](evidence/desktop-overview.png) · [Desktop soạn thảo](evidence/desktop-draft.png) · [Tablet chi tiết](evidence/tablet-detail.png) · [Mobile đọc](evidence/phone-reader.png) · [Mobile soạn](evidence/mobile-draft.png) · [Mobile bảng/nội dung dài](evidence/mobile-rich-document.png)

## Office administration and main integration — 2026-10-04

- Added Office to the application dock and templates/reports to its sidebar navigation; both use canonical access checks.
- Office configuration now exposes a user permission tab. Authorized system grant managers can pick a person and open the existing user editor with Office expanded and filtered. Configuration-only administrators see an explanation instead of a grant editor link. Other applications' grants are retained by the existing authorization workflow.
- No schema change or new permission grant was introduced for this UI update.
- Synced latest main (`a965314`) into the Office branch; resolved only migration manifest metadata by preserving both branches' allowed migrations.
- Validation: TypeScript, production build, migration manifest and Supabase query inventory passed. Full Vitest run: 3,048 passed, 2 skipped; one query-policy test timed out under concurrent build load and passed on its isolated rerun (11.52 seconds). Targeted administration tests: 12 passed.
- Browser walkthrough: Office configuration user picker, selected-user link and responsive content at 390, 820 and 1,440 CSS pixels; no horizontal page overflow. Production editor handoff will be checked after deployment.
