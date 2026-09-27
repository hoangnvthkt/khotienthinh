# Điểm nhấn màu và bóng nhẹ cho Nhật ký

## Phạm vi đã duyệt

Anh xác nhận UX hiện tại: “UX rất tốt đó em, anh duyệt UX này”. Sau đó anh đồng ý hướng màu đề xuất và cho phép vận dụng taste skill. Giữ nguyên bố cục, font, thứ tự trường, nhãn nút và luồng nghiệp vụ; chỉ chỉnh thị giác trong Daily Log V2, không đổi theme toàn hệ thống hoặc legacy.

Taste skill đã được đọc đầy đủ. Skill không dành cho dense admin/data-table UI: không áp dụng hero, bento, font mới hoặc hiệu ứng marketing lên ERP. Phần tham khảo hữu ích là bảo toàn cấu trúc, phân cấp rõ, màu có mục đích, bóng nhẹ có chọn lọc, contrast, dark mode và reduced motion. Tái sử dụng React/CSS/theme/Lucide hiện có, không thêm thư viện hoặc hình trang trí.

| Thành phần | Cách thể hiện |
| --- | --- |
| Gửi tổng hợp / Gửi CHT / Đối chiếu thử nghiệm | Xanh lam; đối chiếu pilot không mang màu duyệt chính thức |
| Duyệt & công bố | Xanh ngọc, chỉ khi hành động này thật sự được phép |
| Trả sửa | Nền hổ phách nhẹ, giữ nhãn và lý do bắt buộc |
| Tiêu đề phiếu, khu vực | Navy ở light mode, xanh nhạt dễ đọc ở dark mode |
| Giờ công / giờ máy | Điểm nhấn xanh lam / hổ phách, vẫn giữ tên và đơn vị |
| Header / khối phiếu / nút chính | Bóng mỏng để nhận biết thứ bậc, không glow hoặc nâng card khi hover |
| Hover và reduced motion | Chuyển màu 140ms; không thêm animation lặp. Tôn trọng reduced-motion hiện có |

Không sửa schema, RPC, phân quyền, dữ liệu tiền/giá hoặc rollout preview. Thêm marker trình bày vào resource editor dùng chung nhưng mọi rule màu mới đều có ancestor Daily Log V2; legacy không nhận CSS mới.

## Kiểm chứng

- RED trên ERP thật: header chưa có bóng, browser assertion thất bại đúng tại `document header needs subtle elevation` (17.0s).
- Sau sửa, nhãn nút gửi đạt contrast 6.70:1 ở light/dark. Probe reduced-motion vẫn RED sau khi chờ media/style update: rule shared `button:not(:disabled)` có shorthand transition `!important` và specificity cao hơn reset toàn cục. Sửa `transition: none !important` chỉ trong actionbar Daily Log; global CSS giữ nguyên. Test chờ `matchMedia` và đo computed duration thực, không sleep/skip. Ảnh chụp kết thúc finite theme transitions trước khi đo màu.
- Full suite sau product change: 2.497 pass / 2 skips có sẵn, 517 files, 27.66s; final sau sửa CSS reduced-motion 22.80s với cùng kết quả. Hai skips Procurement Cloud race ngoài phạm vi, không thêm skip.
- Typecheck/build exit 0; build cuối sau sửa transition 9.00s với cảnh báo chunk lớn có sẵn. Migration baseline 138 active / 402 archived; query inventory 0 findings/errors.
- ERP cuối 4/4 pass, 2.2 phút (date 16.3s / unknown permission 13.2s / mobile-error 18.0s / toàn vòng hai kỹ sư 1.4 phút). Giữ toàn bộ assertions owner/scope, A/B/C, diff/refresh, pilot/evidence, receipt và cleanup. Không thêm skip.
- 18 Cloud SQL smokes pass và rollback. Supabase Cloud test đúng `oymkraihhqahqvzahhtx`, không local/Docker hoặc production writes.
- Commander/history regression sau polish: unknown unit pass 41.6s (tổng 42.1s), known unit pass 39.6s (tổng 40.0s), không skip. Reader/locked/reasoned revision và loading-error-close-retry vẫn được thao tác thật; không suy đoán số liệu hồ sơ cũ.
- Audit Cloud read-only cuối: fixture UX7/UX8 projects/sources/Room memberships/receipts/notifications đều 0; migration history vẫn 44, cuối `20260927075421`. Pilot và binding preview được fixture so sánh trước/sau, không đổi. Dữ liệu fixture tạm đã dọn và có thể tái tạo bằng test; không xóa hồ sơ thật.
- 60 ảnh cho author/summary/review/approval/returned/verified × light/dark × 1440/1024/768/390/360, thêm bộ error. Đã xem trực tiếp author-error1440light/360dark, approval1440light, summary390light, review768dark. Không cuộn ngang body; label/action không đổi; targets và trường cuối mobile không bị actionbar che.
- Contrast computed của header/title/status/metadata và nút enabled đều ≥4.5:1. Gửi 6.70, duyệt 7.68, trả 6.84 light / 10.39 dark. Không phải audit WCAG toàn ứng dụng. Reduced-motion computed duration của actionbar = 0; kiểm tra trên cả form và báo cáo. Không đổi global rule.
- Logs: `polish-red.log`, `polish-green.log`, `polish-erp.log` giữ các thất bại trước sửa; kết quả cuối ở `polish-final-erp.log`, `polish-final-suite.log`, `polish-final-build.log`, `polish-query.log`, `polish-cloud-smokes.log`, `polish-unknown-history.log`, `polish-known-history.log` trong scratch workspace của plan.

Rà soát scoped diff do agent chính thực hiện: chỉ marker/class/tone và CSS trình bày cho phần polish, không thay đổi callback/condition nghiệp vụ; legacy resource editor chỉ thêm marker không có CSS tác động ngoài V2 ancestor. Đây là author self-review, không phải review độc lập toàn branch. Giới hạn thiết bị thật/keyboard/notch và gate tích hợp giữ nguyên như [bằng chứng Task 8](2026-09-26-daily-log-user-centered-ux-acceptance.md).

Dev preview vẫn tại [Nhật ký dự án thử nghiệm](http://127.0.0.1:4197/#/da?projectId=DL-WBS-PILOT-20260925&tab=dailylog). Tài khoản admin preview giữ nguyên. Không push, merge hoặc phát hành.
