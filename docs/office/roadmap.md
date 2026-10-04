# Vioo Office — kế hoạch trên branch riêng

## Nơi làm việc

- GitHub branch: `codex/vioo-office`.
- Nền: `origin/main`, commit `6e32def` (04/10/2026).
- Checkout riêng: `/Users/admin/.codex/worktrees/vioo-office/khotienthinh`.
- Chỉ đưa thay đổi Office lên branch này; không mang lịch sử hoặc thay đổi đang làm của nhánh `feature/refactor-du-an-t9-1` sang.
- Người dùng yêu cầu toàn bộ Office được thực hiện trên branch này. Đây là branch phát triển xuyên suốt các pha, chưa phải bản đã phát hành.
- Giữ giới hạn đã được người dùng xác nhận: Supabase Cloud từ `.env`; chỉ kiểm thử bằng transaction rồi rollback; **chưa áp migration**, không Docker/local, không sub-agent.

## Thứ tự thực hiện

### 1. Nền P0 và chất lượng mã nguồn

Đưa toàn bộ phần đã triển khai vào branch, chạy lại toàn bộ CI của repo sạch, hoàn thiện các lỗi phát hiện khi review. Màn hình dùng service thật; fixture chỉ phục vụ kiểm thử UI. Theo dõi phạm vi và bằng chứng trong `implementation-plan.md` và `validation.md`.

### 2. Nghiệm thu P0 trên môi trường có dữ liệu thật

Hoàn thiện test và runbook cho toàn chuỗi: soạn → lưu nháp → trình duyệt → duyệt → cấp số → phát hành → nhận/đọc → theo dõi → lưu trữ → tìm lại. Bao gồm tài khoản người soạn/người duyệt/văn thư/người nhận, file thật và thông báo thật; thử hai phiên cấp số đồng thời; kiểm tra thu hồi và quyền ngoài phạm vi ở mọi đường truy cập.

Chạy thực tế bước này cần schema đã commit trên một Supabase Cloud phù hợp. Yêu cầu chưa áp migration vẫn còn hiệu lực; việc tạo branch GitHub không phải là cho phép thay đổi database production. Chuẩn bị migration, dữ liệu thử, rollback và hướng dẫn để lần quyết định triển khai sau dựa trên kết quả cụ thể.

### 3. Hoàn thiện P1 của đặc tả trên cùng branch

- Mẫu văn bản nâng cao; soạn thảo bảng/ảnh theo hạ tầng editor và file hiện có.
- Export sổ văn bản đến/đi, danh sách; lịch sử phiên bản nâng cao.
- Quan hệ văn bản, văn bản thay thế và liên kết bản ghi ERP theo quyền truy cập nguồn.
- Yêu cầu xác nhận đã đọc riêng với dấu đã xem tự động.
- Báo cáo vận hành và giao diện tiếp nhận bản scan.

Mỗi nhóm được phát triển thành commit riêng, có test nghiệp vụ, quyền và walkthrough giao diện; không dùng dữ liệu giả làm tính năng production.

### 4. P2 và tích hợp

OCR, trích xuất metadata, tóm tắt, tìm kiếm và soạn thảo AI, chữ ký số, hành động Command Center. Audit các provider hiện có trước; tách rõ chức năng đã có backend với những tích hợp còn cần cấu hình dịch vụ/khóa/chứng thư. Không đưa nút giả hoạt động vào sản phẩm.

### 5. Bàn giao và đưa vào sử dụng

Nghiệm thu đầy đủ, migration và cấu hình quyền/người duyệt/kho/sổ số; triển khai frontend khi được phép. Chỉ coi Office hoạt động thực tế khi chuỗi nghiệp vụ được thực hiện trong Vioo bằng Auth/Storage/API thật. Không tự merge vào `main` hoặc áp migration production chỉ vì branch đã push.

## Rủi ro cần đóng

- Test concurrent numbering nhiều phiên, Storage HTTP, Auth và push thật chưa thể nghiệm thu bằng schema chưa commit.
- Khi tiếp nối số từ hệ thống cũ, cần xác định mốc chuyển đổi trước khi phát hành số thật.
- Những nhóm P1/P2 chưa triển khai phải tiếp tục được đánh dấu chưa xong trong báo cáo; P0 không đồng nghĩa với toàn bộ đặc tả đã hoàn tất.
