# Vioo Office P1 — triển khai trên codex/vioo-office

Chỉ thay đổi mã nguồn trên branch đã chỉ định. Supabase Cloud kiểm thử transaction + rollback; chưa áp migration. Không sub-agent. P0 đã có commit `ef1f587`.

## Người dùng và hành động chính

- Người soạn chọn mẫu, điền biến, kiểm tra nội dung rồi lưu; bản scan có thể chụp từ điện thoại. Không tự ghi đè nội dung đang soạn.
- Văn thư xuất đúng danh sách đang lọc; quản lý đọc báo cáo theo khoảng ngày và quyền hiện tại.
- Người nhận phân biệt mở xem với chủ động xác nhận đã đọc và hiểu.
- Người kiểm tra xem phiên bản và các thay đổi; liên kết chỉ hiện khi có quyền ở cả hai đầu.

## Các bước và bằng chứng

1. Backend: mẫu có version và chống ghi đè; xác nhận riêng với đã xem; query phiên bản, export, báo cáo, liên kết có kiểm tra quyền. SQL smoke trước, triển khai, Cloud rollback.
2. Service và UI: mẫu/biến, chụp scan, xuất Excel, báo cáo, version compare, liên kết, xác nhận. Unit tests cho biến mẫu, workbook và lỗi/quyền; UI walkthrough 1440/820/390.
3. Kiểm tra toàn branch, cập nhật chứng cứ; commit/push cùng branch. Không merge hay deploy production.
4. P2: audit provider AI/chữ ký số và Command Center hiện có; chỉ bật tích hợp khi có cấu hình thật, không mô phỏng ký số bằng chữ ký ảnh.

## Quyết định

- Migration P0 chưa áp ở bất cứ môi trường nào; mở rộng cùng migration để mọi chức năng có một schema nhất quán và một transaction rollback kiểm thử.
- Generic ERP linking bắt đầu với Office, dự án, công việc và hợp đồng dự án, dùng chính hàm phân quyền nguồn; không dùng nhãn đã lưu để lộ thông tin khi mất quyền.
- Export trả một snapshot có giới hạn 5.000 dòng; yêu cầu thu hẹp bộ lọc khi vượt giới hạn, không âm thầm cắt dữ liệu.
- Số văn bản trong mẫu được thay ở backend khi cấp số; các biến khác phải điền trước trình duyệt. Không đưa số dự kiến vào văn bản.

## Tiến độ

- Đã hoàn tất backend, service và UI P1; bổ sung hết hạn, hủy, tag nhiều đơn vị sau phát hành, editor bảng/ảnh/màu/căn chỉnh và AI/OCR theo góp ý sau của chủ dự án.
- Cloud rollback đã chạy P0 + P1 + quyền phòng ban/công trường + quota AI + benchmark 2.000 văn bản. Không áp migration.
- Walkthrough bằng Chromium và WebKit (iPhone 13 mô phỏng), 22 bài kiểm thử. Đã sửa lỗi Safari làm mất block ảnh khi chèn HTML; kiểm tra hoàn tác/làm lại và xóa ảnh giữ nguyên nội dung.
- AI/OCR đã có Edge Function và giao diện, mặc định chưa kích hoạt khi thiếu khóa/model; không gọi provider thật trong kiểm thử.
- Chữ ký số và tích hợp vào giao diện Command Center chưa triển khai: repository chưa có provider/chứng thư hay host Command Center. Service Office độc lập UI đã sẵn sàng cho tích hợp sau.
- Bằng chứng cuối và giới hạn nghiệm thu: [validation.md](validation.md). Hướng dẫn kích hoạt: [activation.md](activation.md).
