# Task 8 — kiểm chứng kỹ thuật và nghiệm thu UX

Ngày kiểm chứng: 27/09/2026. Anh đã trải nghiệm và xác nhận “UX rất tốt đó em, anh duyệt UX này”; sau đó duyệt bổ sung màu sắc/bóng nhẹ. Bằng chứng trước bổ sung được giữ ở dưới; [kiểm chứng phần polish](2026-09-27-daily-log-visual-polish.md) ghi riêng kết quả mới. Task 8 BASE `23f54dc3e39d1f69a4b67f7b3f9cd3a4625c9db8`. Commit/task-done được xác nhận bằng lịch sử git và ledger; nghiệm thu UX không phải cho phép merge/phát hành.

Chỉ agent chính tại worktree `daily-log-clean-integration/khotienthinh`, branch `codex/daily-log-bootstrap-integration`. Supabase Cloud `baseline-vioo-git` (`oymkraihhqahqvzahhtx`), cấu hình root `.env`; không local/Docker. Không sửa/stage/restore workspace Project V2, Procurement, BOQ song song. Không đổi migration/schema/Room authority, dữ liệu legacy hoặc rollout dự án admin-preview trong Task 8. Cache CLI `supabase/.temp/cli-latest` không thuộc commit.

## Luồng được thao tác trên ERP thật

Browser dùng anon key + session của sáu tài khoản non-admin hiện có: kỹ sư A/B, người tổng hợp, CHT, người đọc và người không có quyền. Mỗi persona được kiểm tra `is_admin=false`. Không reset tài khoản/mật khẩu web. Management access chỉ tạo/dọn fixture và thiết lập phạm vi test; không đưa service role vào browser.

| Điểm kiểm chứng | Kết quả quan sát |
| --- | --- |
| Người lập và khu vực | A tạo/gửi hai phiếu A+C; B tạo/gửi phiếu B bằng UI. Chủ sở hữu được kiểm tra từ Cloud, không suy ra theo thứ tự danh sách. |
| Chọn phiếu | Người tổng hợp chỉ chọn A+B; C không được đưa vào bản tổng hợp. Tổng quan nhận/chọn = 3/2, không gọi đó là đủ mọi kỹ sư. |
| Khối lượng và chồng lấn | Hai nguồn 30% không tự thành 60%. Nháp chưa chốt lưu được nhưng chưa gửi được. Người tổng hợp chốt 30% có lý do; sau sửa nguồn chốt chính thức 31% có căn cứ riêng. |
| Trả đúng phiếu | CHT nhập lý do dài và trả A. B/C giữ nguyên toàn bộ bản ghi tại thời điểm trả. Nút trả không dùng được khi lý do trống. |
| Sửa/gửi lại | A sửa lượng hôm nay thành 32, sửa nội dung và nhân công 5→6 người, gửi lại bằng UI. Phiên bản nguồn A = 6. C vẫn nguyên bản sau toàn bộ vòng công bố. |
| Bản sao và refresh | Nội dung cũ đã lưu còn nguyên khi nguồn gửi lại. UI hiện nhận xét, mở diff để đối chiếu, chỉ cập nhật sau **Cập nhật từ phiếu**; không tự ghi đè bản sao. |
| Pilot/enforced | Pilot trả `publishedProgress=false`, bản tổng hợp vẫn chờ CHT, evidence chưa xác nhận = 0 dòng. Enforced chỉ bật trong UUID ERP project tạm; trả true và verified. Pilot admin-preview không đổi. |
| Nguồn lực và lineage | Hồ sơ xác nhận có 48 giờ công, 12 giờ máy, 2 dòng evidence; một WBS chính thức 31%, nguồn A v6 và nhận xét CHT được giữ. Không diễn giải lượt người/máy thành số duy nhất. |
| Không duplicate | Double-click duyệt tạo đúng 1 publication receipt đã lưu, chứa đúng WBS và 2 resource lineage IDs. Pilot receipt là shadow riêng, không giả thành công bố. |
| Quyền | Raw RPC sai owner/scope và persona denied trả 42501. Reader xem hồ sơ không có input/select/textarea hoặc nút sửa/trả/gửi/xóa. Không cấp kỹ sư quyền CHT để pass. |

Fixture là ERP project UUID tạm trong Cloud test đã được cho phép, không tạo Cloud project mới. Chỉ cấp ERP-entry theo project, clone Room Daily Log đang hoạt động; persona denied không có Room actions. Người đọc cần thêm riêng `payment.view_resource_evidence` read-only cho đúng project tạm vì membership cũ đang inactive. Không kích hoạt membership cũ hoặc sửa binding toàn cục. Cleanup kiểm tra project/log/source/receipt/grant/notification tạm bằng 0 và so sánh pilot/binding trước–sau; dữ liệu test tạm đã dọn, có thể tái tạo bằng test. Không xóa hồ sơ thật.

## RED → GREEN và điều chỉnh harness

- Mobile: nút xóa rộng 36px, vùng chọn phiếu cao 40px → CSS scoped tối thiểu 44px. Không chỉnh global CSS.
- Link báo cáo: denied hiển thị danh sách trống và số 0; lỗi đọc quyền bị chuyển thành tập quyền rỗng → trạng thái loading/unknown có retry/denied rõ ràng, chỉ tại direct report link. Không tự đặt thêm quyền view làm chặn người có edit-only actions; server vẫn là authority. Regression lỗi quyền RED → GREEN 16.0s, final 14.0s.
- Đổi ngày: giữ response ngày cũ, chọn ngày mới thấy A/C, rồi thả response cũ làm mất A/C trong khi input còn ngày mới → request-generation guard bỏ success/error/finally lỗi thời, cả completion của fallback legacy. RED 20.1s → GREEN 16.9s, final 17.5s.
- Lưu lỗi có kiểm soát 409: input `12,5` và nội dung được giữ, feedback được focus; bỏ interception và lưu thật lên Cloud thành công. Đây không phải bằng chứng Cloud đã có outage thật.
- CLI config test fixture: synthetic diagnostic RED → thông báo an toàn GREEN, không in raw CLI output có thể chứa credential. Test mới chỉ dùng chuỗi giả, không dùng secret thật.
- Harness corrections, không phải sửa product để giảm validation: native CHT label gồm cả option text; SQL numeric giờ công trả string; `publishedProgress` là flag wrapper API, không phải key của stored base receipt. Receipt check cuối đếm toàn bộ receipt của đúng log và kiểm tra lineage thay vì lọc theo key không được lưu.
- Regression report loading có hai request dưới StrictMode/list reload; diagnostic ghi attempt1 held/attempt2 bypass nên test lỗi giả biến mất. Interception cuối giữ lỗi đến **click Thử lại thực sự**, ghi nhận trạng thái release ở Node để không bật lại khi reload. Những bản harness trung gian thất bại ở retry/reload được giữ trong logs; không bỏ loading/error/close/retry assertions. Chỉ sửa fixture của test Task 7, không sửa report producer.

## Lệnh và kết quả cuối

Chạy tại isolated worktree. Cloud commands dùng prefix `node --env-file=/Users/admin/khotienthinh/.env`; không in nội dung `.env`. Playwright dùng `node_modules/@playwright/test/cli.js test` (tương đương CLI `npx playwright test` đã cài).

| Lệnh | Kết quả đọc được |
| --- | --- |
| `npm test -- --maxWorkers=2` | 2.497 pass, 2 skips có sẵn; 517 files pass; 95.60s. Không thêm skip. |
| `npm run lint` | exit 0, gồm thay đổi harness cuối |
| `npm run build` | exit 0, 34.22s, với product code cuối; cảnh báo chunk >500kB có sẵn. Chỉ test/docs đổi sau build. |
| `npm run check:supabase-migrations` | 138 active / 402 archived, pass |
| `npm run check:supabase-queries` | 0 findings/errors, inventory không đổi |
| `tests/daily-log/run-summary-resubmit-cloud.mjs --smoke` | 18 smokes pass, mỗi probe rollback; gồm nguồn/chọn/trả/gửi/quantity/publication/legacy/pilot/resource evidence |
| `--config tests/daily-log/ux-cloud-playwright.config.ts` | 4/4 ERP tests pass, 2.6 phút: date race 17.5s, unknown permission 14.0s, mobile/error/focus 21.3s, toàn vòng hai kỹ sư 1.6 phút |
| `DAILY_LOG_CHT_UNKNOWN_UNIT=1 … --config tests/daily-log/commander-cloud-playwright.config.ts` | pass 47.0s (tổng 47.7s); unit và quantities null vẫn null, 2 quality records, reader/locked/reasoned revision |
| Cùng commander config, đơn vị xác định | pass 50.3s (tổng 50.7s); controlled loading/error/retry và toàn vòng CHT/history |
| `npm test -- tests/daily-log/ux-test-sessions.test.ts` | 1 pass; synthetic CLI diagnostic bị chặn |
| `git diff --check` / dev HTTP | clean / 200 tại 4197 |

Hai skips có sẵn là Procurement Cloud race suites `g2-allocation-race.cloud.test.ts` và `g5-purchase-order-race.cloud.test.ts`, chưa cấu hình DB URL cho bare local suite. Không thuộc Daily Log; không sửa/bật chúng trên phân vùng song song. Cảnh báo FORCE_COLOR/NO_COLOR của runner không phải lỗi workflow.

Logs trong `.superpowers/sdd/2026-09-26-daily-log-user-centered-ux-revision/`: `task-8-final-erp-receipt.log`, `task-8-final-suite-receipt.log`, `task-8-final-lint-persistent-retry.log`, `task-8-final-lint-build-post-race.log`, `task-8-final-cloud-smokes.log`, `task-8-final-unknown-history-persistent-retry.log`, `task-8-final-known-history-persistent-retry.log`. Scratch giữ nguyên vì chưa qua nghiệm thu/final review; không phải artifact lịch sử đã commit.

## Walkthrough giao diện và giới hạn

Có đủ 50 ảnh `ux8-{author|summary|review|verified|returned}-{light|dark}-{1440|1024|768|390|360}.png`, từ DOM ERP thật. Viewports: 1440×900, 1024×768, 768×1024, 390×844, 360×800. Bổ sung ảnh error và report unknown-unit.

Đã xem các mẫu author light1440/dark360; summary light390/light360; review dark768; returned light1024/dark390; verified light1440/dark360; error light360; unknown light1024/dark390. Phân cấp ngày/người/khu/trạng thái và action rõ; lý do dài wrap, không cắt; verified chỉ có báo cáo và đóng. Desktop dùng bảng/section phẳng, mobile dùng card và action đáy; không cuộn ngang toàn body. Vùng nguồn lực mở dưới đúng hạng mục.

Kiểm tra DOM: keyboard Tab đổi focus, outline input 2px; lỗi khối lượng âm có aria-invalid và chặn gửi; feedback lỗi được focus; action mobile và nút xóa ≥44px; trường ghi chú cuối cuộn lên trên thanh action. CSS có padding bù và `env(safe-area-inset-bottom)`. Header contrast đo từ computed styles: title ≥13.71, metadata ≥4.83, status ≥6.81 trên các trạng thái đã chụp; vượt 4.5:1 cho các nhãn đó, không phải tuyên bố audit toàn bộ WCAG.

Task 8 đổi theme class hiện có để chụp mà không mất dữ liệu đang nhập; không chứng minh theme persistence. Commander regression dùng nút **Dark Mode** và reload thật. Chromium viewport giả lập không chứng minh bàn phím ảo, notch/safe-area hoặc zoom trên iOS/Android thật. Không tự dùng ảnh/test count để xác nhận đọc hiểu trong 5 giây.

Rà soát Task 8 do chính tác giả thực hiện theo yêu cầu không dùng sub-agent; không phải review độc lập. Whole-branch final review và gate tích hợp còn riêng sau nghiệm thu. Không kết luận sẵn sàng merge/phát hành.

## Phần anh nghiệm thu

[Hướng dẫn theo nút thật](2026-09-27-daily-log-user-guide.md). Dev giữ tại [Nhật ký dự án pilot](http://127.0.0.1:4197/#/da?projectId=DL-WBS-PILOT-20260925&tab=dailylog); tài khoản admin preview/mật khẩu web đã cấp giữ nguyên. Pilot chỉ đối chiếu, chưa công bố chính thức.

Anh đã xác nhận UX sau trải nghiệm bản dev, không dùng test count thay cho xác nhận đó. Hướng màu gửi xanh lam / duyệt xanh ngọc / trả sửa hổ phách cũng đã được anh duyệt trước khi triển khai. Giữ nguyên mô hình mỗi kỹ sư lập phiếu, người tổng hợp chọn phiếu, CHT trả đúng phiếu để sửa/gửi lại. Không hỏi lại quyết định nghiệp vụ đã khóa; gate review toàn branch và tích hợp vẫn riêng.
